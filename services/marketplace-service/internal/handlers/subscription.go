package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/outbox"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/services"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// SubscriptionHandler handles subscription lifecycle.
type SubscriptionHandler struct {
	cfg       *config.Config
	svc       *services.SubscriptionService
	stripeSvc *services.StripeService
	publisher *outbox.Publisher
	log       *zap.Logger
}

// NewSubscriptionHandler creates a subscription handler.
func NewSubscriptionHandler(
	cfg *config.Config,
	pool *pgxpool.Pool,
	stripe *client.API,
	pub *outbox.Publisher,
	log *zap.Logger,
) *SubscriptionHandler {
	return &SubscriptionHandler{
		cfg:       cfg,
		svc:       services.NewSubscriptionService(pool, services.NewStripeService(stripe, cfg.StripePublishableKey)),
		stripeSvc: services.NewStripeService(stripe, cfg.StripePublishableKey),
		publisher: pub,
		log:       log,
	}
}

// CreateRequest is the POST body for creating a subscription.
type CreateRequest struct {
	TargetID   string `json:"targetId"`
	TargetType string `json:"targetType"` // "author" | "news_channel"
	TierID     string `json:"tierId"`
}

// Create creates a new subscription.
//
//	POST /api/v1/market/subscriptions
func (h *SubscriptionHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, utils.BadRequest("Invalid body", "INVALID_BODY"))
		return
	}

	targetID, err := uuid.Parse(req.TargetID)
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid targetId", "INVALID_ID"))
		return
	}
	tierID, err := uuid.Parse(req.TierID)
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid tierId", "INVALID_ID"))
		return
	}
	if req.TargetType != "author" && req.TargetType != "news_channel" {
		writeError(w, r, utils.BadRequest("Invalid targetType", "INVALID_TARGET_TYPE"))
		return
	}

	// TODO: fetch tier price from `subscription_tiers` table, then create
	// Stripe subscription via StripeService. Full implementation in v2.
	writeJSON(w, http.StatusCreated, map[string]any{
		"message":  "Subscription creation pending v2 implementation",
		"buyer_id": user.ID,
		"target_id": targetID.String(),
		"tier_id":   tierID.String(),
	})
}

// List returns all active subscriptions for the current user.
//
//	GET /api/v1/market/subscriptions
func (h *SubscriptionHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}
	// TODO: real query
	writeJSON(w, http.StatusOK, map[string]any{
		"subscriptions": []any{},
	})
}

// Cancel cancels a subscription.
//
//	DELETE /api/v1/market/subscriptions/:subscriptionID
func (h *SubscriptionHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	subID, err := uuid.Parse(chi.URLParam(r, "subscriptionID"))
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid subscription ID", "INVALID_ID"))
		return
	}

	sub, err := h.svc.Cancel(r.Context(), services.CancelInput{
		SubscriptionID: subID,
		BuyerID:        uuid.MustParse(user.ID),
		AtPeriodEnd:    true,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, sub)
}