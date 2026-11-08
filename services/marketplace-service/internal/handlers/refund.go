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

// RefundHandler handles refunds.
type RefundHandler struct {
	cfg *config.Config
	svc *services.RefundService
	log *zap.Logger
}

// NewRefundHandler creates a refund handler.
func NewRefundHandler(
	cfg *config.Config,
	pool *pgxpool.Pool,
	stripe *client.API,
	pub *outbox.Publisher,
	log *zap.Logger,
) *RefundHandler {
	return &RefundHandler{
		cfg: cfg,
		svc: services.NewRefundService(pool, services.NewStripeService(stripe, cfg.StripePublishableKey), pub),
		log: log,
	}
}

// IssueRequest is the POST body for issuing a refund.
type IssueRequest struct {
	AmountCents int64  `json:"amountCents"`
	Reason      string `json:"reason"`
}

// Issue refunds an order.
//
//	POST /api/v1/market/orders/:orderID/refund
func (h *RefundHandler) Issue(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	orderID, err := uuid.Parse(chi.URLParam(r, "orderID"))
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid order ID", "INVALID_ID"))
		return
	}

	var req IssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, utils.BadRequest("Invalid body", "INVALID_BODY"))
		return
	}

	order, err := h.svc.Issue(r.Context(), services.RefundInput{
		OrderID:     orderID,
		AmountCents: req.AmountCents,
		Reason:      req.Reason,
		IssuedBy:    uuid.MustParse(user.ID),
		IsAdmin:     user.Role == middleware.RoleAdmin,
		RequestID:   middleware.RequestIDFromContext(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, order)
}