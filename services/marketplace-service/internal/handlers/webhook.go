package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v76"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/db"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/outbox"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/services"
)

// WebhookHandler processes Stripe webhook events.
type WebhookHandler struct {
	cfg       *config.Config
	db        *pgxpool.Pool
	redis     *redis.Client
	stripeSvc *services.StripeService
	publisher *outbox.Publisher
	log       *zap.Logger
}

// NewWebhookHandler creates a webhook handler.
func NewWebhookHandler(
	cfg *config.Config,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	pub *outbox.Publisher,
	log *zap.Logger,
) *WebhookHandler {
	return &WebhookHandler{
		cfg:       cfg,
		db:        pool,
		redis:     rdb,
		stripeSvc: services.NewStripeService(nil, ""),
		publisher: pub,
		log:       log,
	}
}

// Handle receives a Stripe webhook.
//
//	POST /webhooks/stripe
func (h *WebhookHandler) Handle(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1*1024*1024))
	if err != nil {
		h.log.Warn("webhook_body_read_failed", zap.Error(err))
		http.Error(w, "body read failed", http.StatusBadRequest)
		return
	}

	sigHeader := r.Header.Get("Stripe-Signature")
	event, err := h.stripeSvc.ConstructWebhookEvent(body, sigHeader, h.cfg.StripeWebhookSecret)
	if err != nil {
		h.log.Warn("webhook_signature_invalid", zap.Error(err))
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	// Dedup
	dedupKey := db.Key("stripe", "event", event.ID)
	ok, err := h.redis.SetNX(r.Context(), dedupKey, "1", 24*time.Hour).Result()
	if err == nil && !ok {
		h.log.Info("webhook_duplicate", zap.String("event_id", event.ID), zap.String("type", string(event.Type)))
		w.WriteHeader(http.StatusOK)
		return
	}

	h.log.Info("webhook_received", zap.String("event_id", event.ID), zap.String("type", string(event.Type)))

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	var handleErr error
	switch event.Type {
	case "checkout.session.completed":
		handleErr = h.handleCheckoutCompleted(ctx, event)
	case "payment_intent.succeeded":
		handleErr = h.handlePaymentIntentSucceeded(ctx, event)
	case "payment_intent.payment_failed":
		handleErr = h.handlePaymentIntentFailed(ctx, event)
	case "charge.refunded":
		handleErr = h.handleChargeRefunded(ctx, event)
	case "customer.subscription.created", "customer.subscription.updated":
		handleErr = h.handleSubscriptionChanged(ctx, event)
	case "customer.subscription.deleted":
		handleErr = h.handleSubscriptionDeleted(ctx, event)
	case "account.updated":
		handleErr = h.handleConnectAccountUpdated(ctx, event)
	default:
		h.log.Debug("webhook_unhandled", zap.String("type", string(event.Type)))
	}

	if handleErr != nil {
		h.log.Error("webhook_handler_failed", zap.String("event_id", event.ID), zap.Error(handleErr))
		_ = h.redis.Del(r.Context(), dedupKey).Err()
		http.Error(w, "handler failed", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"received":true}`))
}

func (h *WebhookHandler) handleCheckoutCompleted(ctx context.Context, event stripe.Event) error {
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		return fmt.Errorf("unmarshal session: %w", err)
	}

	orderIDStr, ok := session.Metadata["order_id"]
	if !ok {
		return fmt.Errorf("missing order_id in metadata")
	}
	orderID, err := uuid.Parse(orderIDStr)
	if err != nil {
		return fmt.Errorf("invalid order_id: %w", err)
	}

	now := time.Now()

	err = db.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE orders
			SET status = $1, stripe_payment_intent_id = $2, completed_at = $3, updated_at = $4
			WHERE id = $5 AND status = 'pending'
		`, string(models.OrderSucceeded), session.PaymentIntent.ID, now, now, orderID)
		if err != nil {
			return fmt.Errorf("update order: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil
		}

		return outbox.Insert(ctx, tx, outbox.Event{
			ID:          uuid.NewString(),
			Type:        "OrderPaid",
			AggregateID: orderID.String(),
			OccurredAt:  now,
			Payload: map[string]any{
				"orderId":                orderID.String(),
				"stripeSessionId":        session.ID,
				"stripePaymentIntentId":  session.PaymentIntent.ID,
			},
			Meta: outbox.EventMeta{Service: "marketplace-service"},
		})
	})
	if err != nil {
		return fmt.Errorf("handle checkout completed: %w", err)
	}

	h.log.Info("order_paid", zap.String("order_id", orderID.String()))
	return nil
}

func (h *WebhookHandler) handlePaymentIntentSucceeded(ctx context.Context, event stripe.Event) error {
	return nil
}

func (h *WebhookHandler) handlePaymentIntentFailed(ctx context.Context, event stripe.Event) error {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		return fmt.Errorf("unmarshal payment intent: %w", err)
	}
	orderIDStr, ok := pi.Metadata["order_id"]
	if !ok {
		return nil
	}
	failureMsg := ""
	if pi.LastPaymentError != nil {
		failureMsg = pi.LastPaymentError.Msg
	}
	_, err := h.db.Exec(ctx, `
		UPDATE orders
		SET status = $1, failure_reason = $2, updated_at = $3
		WHERE id = $4
	`, string(models.OrderFailed), failureMsg, time.Now(), orderIDStr)
	if err != nil {
		return fmt.Errorf("update failed order: %w", err)
	}
	return nil
}

func (h *WebhookHandler) handleChargeRefunded(ctx context.Context, event stripe.Event) error {
	var charge stripe.Charge
	if err := json.Unmarshal(event.Data.Raw, &charge); err != nil {
		return fmt.Errorf("unmarshal charge: %w", err)
	}
	if charge.PaymentIntent == nil {
		return nil
	}
	_, err := h.db.Exec(ctx, `
		UPDATE orders
		SET status = $1, refunded_at = $2, updated_at = $3
		WHERE stripe_payment_intent_id = $4
	`, string(models.OrderRefunded), time.Now(), time.Now(), charge.PaymentIntent.ID)
	if err != nil {
		return fmt.Errorf("update refunded order: %w", err)
	}
	return nil
}

func (h *WebhookHandler) handleSubscriptionChanged(ctx context.Context, event stripe.Event) error {
	// TODO: upsert subscription record from Stripe subscription object.
	return nil
}

func (h *WebhookHandler) handleSubscriptionDeleted(ctx context.Context, event stripe.Event) error {
	// TODO: mark subscription canceled.
	return nil
}

func (h *WebhookHandler) handleConnectAccountUpdated(ctx context.Context, event stripe.Event) error {
	// TODO: update author's Connect status.
	return nil
}