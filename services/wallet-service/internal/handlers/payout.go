package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/services"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// PayoutHandler handles author payout requests + listings.
type PayoutHandler struct {
	cfg     *config.Config
	db      *pgxpool.Pool
	stripe  *client.API
	service *services.PayoutService
	log     *zap.Logger
}

// NewPayoutHandler creates a payout handler.
func NewPayoutHandler(cfg *config.Config, db *pgxpool.Pool, stripe *client.API, log *zap.Logger) *PayoutHandler {
	return &PayoutHandler{
		cfg:     cfg,
		db:      db,
		stripe:  stripe,
		service: services.NewPayoutService(cfg, db, stripe, log),
		log:     log,
	}
}

// RequestInput is the POST body for payout requests.
type RequestInput struct {
	AmountCents int64  `json:"amountCents"`
	Currency    string `json:"currency"`
}

// Request initiates a payout to the author's Connect account.
//
//	POST /api/v1/wallet/payouts/request
//
// Idempotency: pass `Idempotency-Key` header to prevent duplicate payouts.
func (h *PayoutHandler) Request(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	var req RequestInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, utils.BadRequest("Invalid body", "INVALID_BODY"))
		return
	}

	if req.Currency == "" {
		req.Currency = "USD"
	}

	// Convert cents → decimal dollars
	amount := decimal.NewFromInt(req.AmountCents).Div(decimal.NewFromInt(100))

	payout, err := h.service.RequestPayout(r.Context(), services.RequestPayoutInput{
		AuthorID: user.ID,
		Amount:   amount,
		Currency: req.Currency,
		RequestID: middleware.RequestIDFromContext(r.Context()),
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusCreated, payout)
}

// List returns the current user's payouts (paginated).
//
//	GET /api/v1/wallet/payouts?limit=20
func (h *PayoutHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, amount::text, currency, status,
		       COALESCE(stripe_transfer_id, ''), COALESCE(reason, ''),
		       requested_at, completed_at, failed_at
		FROM payouts
		WHERE author_id = $1
		ORDER BY requested_at DESC
		LIMIT 50
	`, user.ID)
	if err != nil {
		h.log.Error("payouts_query_failed", zap.Error(err))
		writeError(w, r, utils.Internal("Failed to load payouts", err))
		return
	}
	defer rows.Close()

	var payouts []map[string]any
	for rows.Next() {
		var (
			id, amount, currency, status, transferID, reason string
			requestedAt                                       interface{}
			completedAt, failedAt                             interface{}
		)
		if err := rows.Scan(&id, &amount, &currency, &status, &transferID, &reason,
			&requestedAt, &completedAt, &failedAt); err != nil {
			continue
		}
		payouts = append(payouts, map[string]any{
			"id":               id,
			"amount":           amount,
			"currency":         currency,
			"status":           status,
			"stripeTransferId": transferID,
			"reason":           reason,
			"requestedAt":      requestedAt,
			"completedAt":      completedAt,
			"failedAt":         failedAt,
		})
	}

	if payouts == nil {
		payouts = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"payouts": payouts})
}