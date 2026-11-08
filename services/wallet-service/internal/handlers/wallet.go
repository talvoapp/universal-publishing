// Package handlers implements HTTP handlers for the wallet service.
package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// WalletHandler serves wallet balance + summary.
type WalletHandler struct {
	cfg *config.Config
	db  *pgxpool.Pool
	log *zap.Logger
}

// NewWalletHandler creates a wallet handler.
func NewWalletHandler(cfg *config.Config, db *pgxpool.Pool, log *zap.Logger) *WalletHandler {
	return &WalletHandler{cfg: cfg, db: db, log: log}
}

// Get returns the current user's wallet summary.
//
//	GET /api/v1/wallet
//
// Response:
//
//	{
//	  "authorId": "uuid",
//	  "currency": "USD",
//	  "available": "123.45",
//	  "pending": "0",
//	  "lifetime": "500.00",
//	  "paidOut": "300.00",
//	  "connectStatus": "active"
//	}
func (h *WalletHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	authorID := user.ID
	currency := "USD"

	// Fetch balances from ledger
	available, pending, err := ledger.AuthorBalances(r.Context(), h.db, authorID, currency)
	if err != nil {
		h.log.Error("balance_query_failed", zap.Error(err), zap.String("author_id", authorID))
		writeError(w, r, utils.Internal("Failed to load balance", err))
		return
	}

	lifetime, err := ledger.TotalAuthorEarnings(r.Context(), h.db, authorID, currency)
	if err != nil {
		h.log.Error("lifetime_query_failed", zap.Error(err), zap.String("author_id", authorID))
		writeError(w, r, utils.Internal("Failed to load lifetime earnings", err))
		return
	}

	// Paid out = sum of completed payouts
	var paidOutStr string
	err = h.db.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(amount), 0)::text
		FROM payouts
		WHERE author_id = $1 AND status = 'completed' AND currency = $2
	`, authorID, currency).Scan(&paidOutStr)
	if err != nil {
		h.log.Warn("paidout_query_failed", zap.Error(err))
		paidOutStr = "0"
	}

	// Connect status (may not exist)
	var connectStatus string
	_ = h.db.QueryRow(r.Context(), `
		SELECT status FROM author_connect_accounts WHERE author_id = $1
	`, authorID).Scan(&connectStatus)
	if connectStatus == "" {
		connectStatus = "not_onboarded"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"authorId":      authorID,
		"currency":      currency,
		"available":     available.StringFixed(2),
		"pending":       pending.StringFixed(2),
		"lifetime":      lifetime.StringFixed(2),
		"paidOut":       paidOutStr,
		"connectStatus": connectStatus,
	})
}