package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// LedgerHandler serves ledger entry queries.
type LedgerHandler struct {
	cfg *config.Config
	db  *pgxpool.Pool
	log *zap.Logger
}

// NewLedgerHandler creates a ledger handler.
func NewLedgerHandler(cfg *config.Config, db *pgxpool.Pool, log *zap.Logger) *LedgerHandler {
	return &LedgerHandler{cfg: cfg, db: db, log: log}
}

// LedgerEntryDTO is a single row in the response.
type LedgerEntryDTO struct {
	TransactionID string    `json:"transactionId"`
	Type          string    `json:"type"`
	Reference     string    `json:"reference"`
	AccountType   string    `json:"accountType"`
	AccountKey    string    `json:"accountKey"`
	Debit         string    `json:"debit"`
	Credit        string    `json:"credit"`
	Currency      string    `json:"currency"`
	OccurredAt    time.Time `json:"occurredAt"`
	CreatedAt     time.Time `json:"createdAt"`
}

// List returns the current user's ledger entries, paginated.
//
//	GET /api/v1/wallet/ledger?limit=20&cursor_time=...&cursor_id=...
//
// Only the author's own account is shown (plus platform:fees as a
// secondary row per sale, for transparency).
func (h *LedgerHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	q := r.URL.Query()
	limit := 20
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	var cursorTime *time.Time
	var cursorID *string
	if ctStr, idStr := q.Get("cursor_time"), q.Get("cursor_id"); ctStr != "" && idStr != "" {
		if ct, err := time.Parse(time.RFC3339, ctStr); err == nil {
			cursorTime = &ct
		}
		cursorID = &idStr
	}

	// Build query. We join entries with their parent transactions to
	// fetch semantic fields (type, reference) in one go.
	query := `
		SELECT
			e.transaction_id, t.type, t.reference,
			e.account_type, e.account_key,
			e.debit::text, e.credit::text, e.currency,
			t.occurred_at, e.created_at
		FROM ledger_entries e
		JOIN ledger_transactions t ON t.id = e.transaction_id
		WHERE e.account_type = 'author' AND e.account_key = $1
	`
	args := []any{user.ID}

	if cursorTime != nil && cursorID != nil {
		args = append(args, *cursorTime, *cursorID)
		query += ` AND (t.occurred_at, e.transaction_id) < ($2, $3)`
	}

	args = append(args, limit+1)
	query += ` ORDER BY t.occurred_at DESC, e.transaction_id DESC LIMIT $` + strconv.Itoa(len(args))

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		h.log.Error("ledger_query_failed", zap.Error(err))
		writeError(w, r, utils.Internal("Failed to load ledger", err))
		return
	}
	defer rows.Close()

	var entries []LedgerEntryDTO
	for rows.Next() {
		var e LedgerEntryDTO
		if err := rows.Scan(
			&e.TransactionID, &e.Type, &e.Reference,
			&e.AccountType, &e.AccountKey,
			&e.Debit, &e.Credit, &e.Currency,
			&e.OccurredAt, &e.CreatedAt,
		); err != nil {
			h.log.Error("ledger_scan_failed", zap.Error(err))
			continue
		}
		entries = append(entries, e)
	}

	var nextCursor string
	if len(entries) > limit {
		last := entries[limit-1]
		nextCursor = last.OccurredAt.Format(time.RFC3339) + "|" + last.TransactionID
		entries = entries[:limit]
	}

	if entries == nil {
		entries = []LedgerEntryDTO{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entries":     entries,
		"next_cursor": nextCursor,
	})
}

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	reqID := middleware.RequestIDFromContext(r.Context())
	utils.AsAppError(err).Write(w, reqID)
}