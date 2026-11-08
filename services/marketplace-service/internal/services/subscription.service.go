package services

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/outbox"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// SubscriptionService handles subscription lifecycle + cancellation.
type SubscriptionService struct {
	db     *pgxpool.Pool
	stripe *StripeService
}

func NewSubscriptionService(db *pgxpool.Pool, stripe *StripeService) *SubscriptionService {
	return &SubscriptionService{db: db, stripe: stripe}
}

// CancelInput is the input for Cancel.
type CancelInput struct {
	SubscriptionID uuid.UUID
	BuyerID        uuid.UUID
	AtPeriodEnd    bool
	Reason         string
}

// Cancel cancels a subscription. If AtPeriodEnd is true, access continues
// until the current period ends; otherwise it cancels immediately.
//
// Returns the updated Subscription.
func (s *SubscriptionService) Cancel(ctx context.Context, in CancelInput) (*models.Subscription, error) {
	// Fetch + authorize
	sub, err := s.getByID(ctx, in.SubscriptionID)
	if err != nil {
		return nil, err
	}
	if sub.BuyerID != in.BuyerID {
		return nil, utils.Forbidden("You do not own this subscription", "NOT_OWNER")
	}
	if sub.Status == models.SubCanceled && sub.CanceledAt != nil {
		return sub, nil // idempotent
	}

	// Cancel in Stripe (via Stripe SDK — omitted here for brevity)
	// In production:
	//   params := &stripe.SubscriptionParams{CancelAtPeriodEnd: stripe.Bool(in.AtPeriodEnd)}
	//   _, err := s.client.Subscriptions.Update(sub.StripeSubscriptionID, params)

	now := time.Now()
	sub.CancelAtPeriodEnd = in.AtPeriodEnd
	sub.CanceledAt = &now
	if !in.AtPeriodEnd {
		sub.Status = models.SubCanceled
	}

	// Persist
	_, err = s.db.Exec(ctx, `
		UPDATE subscriptions
		SET status = $1, cancel_at_period_end = $2, canceled_at = $3, updated_at = now()
		WHERE id = $4
	`, string(sub.Status), sub.CancelAtPeriodEnd, sub.CanceledAt, sub.ID)
	if err != nil {
		return nil, fmt.Errorf("update subscription: %w", err)
	}

	// Emit outbox event
	_, _ = s.db.Exec(ctx, `
		INSERT INTO outbox (id, event_type, aggregate_id, payload, meta, created_at)
		VALUES ($1, $2, $3, $4, $5, now())
	`,
		uuid.New().String(),
		"SubscriptionCanceled",
		sub.ID.String(),
		fmt.Sprintf(`{"subscriptionId":"%s","buyerId":"%s","atPeriodEnd":%t}`, sub.ID, sub.BuyerID, in.AtPeriodEnd),
		`{"service":"marketplace-service"}`,
	)

	return sub, nil
}

func (s *SubscriptionService) getByID(ctx context.Context, id uuid.UUID) (*models.Subscription, error) {
	row := s.db.QueryRow(ctx, `
		SELECT id, buyer_id, target_id, target_type, tier_id,
		       stripe_subscription_id, stripe_customer_id, status, currency,
		       amount, current_period_start, current_period_end,
		       cancel_at_period_end, canceled_at, trial_end,
		       created_at, updated_at
		FROM subscriptions
		WHERE id = $1
	`, id)
	var sub models.Subscription
	var amountStr string
	err := row.Scan(
		&sub.ID, &sub.BuyerID, &sub.TargetID, &sub.TargetType, &sub.TierID,
		&sub.StripeSubscriptionID, &sub.StripeCustomerID, &sub.Status, &sub.Currency,
		&amountStr, &sub.CurrentPeriodStart, &sub.CurrentPeriodEnd,
		&sub.CancelAtPeriodEnd, &sub.CanceledAt, &sub.TrialEnd,
		&sub.CreatedAt, &sub.UpdatedAt,
	)
	if err != nil {
		return nil, utils.NotFound("Subscription not found", "SUBSCRIPTION_NOT_FOUND")
	}
	sub.Amount, _ = decimal.NewFromString(amountStr)
	return &sub, nil
}