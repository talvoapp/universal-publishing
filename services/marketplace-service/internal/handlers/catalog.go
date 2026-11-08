package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/services"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// CatalogHandler exposes read-only catalog operations.
type CatalogHandler struct {
	cfg *config.Config
	svc *services.CatalogService
	log *zap.Logger
}

// NewCatalogHandler creates a catalog handler.
func NewCatalogHandler(cfg *config.Config, db *pgxpool.Pool, log *zap.Logger) *CatalogHandler {
	return &CatalogHandler{
		cfg: cfg,
		svc: services.NewCatalogService(db),
		log: log,
	}
}

// List returns a paginated list of published items.
//
//	GET /api/v1/market/items?type=book&limit=20&cursor_time=...&cursor_id=...
func (h *CatalogHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := 20
	if s := q.Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	filter := services.ListFilter{
		Limit: limit,
	}

	if t := q.Get("type"); t != "" {
		filter.ItemType = models.ItemType(t)
	}

	// Cursor pagination — both fields required together
	if ctStr, idStr := q.Get("cursor_time"), q.Get("cursor_id"); ctStr != "" && idStr != "" {
		if ct, err := time.Parse(time.RFC3339, ctStr); err == nil {
			filter.CursorTime = &ct
		}
		if id, err := uuid.Parse(idStr); err == nil {
			filter.CursorID = &id
		}
	}

	items, nextTime, nextID, err := h.svc.List(r.Context(), filter)
	if err != nil {
		writeError(w, r, err)
		return
	}

	var nextCursor string
	if nextTime != nil && nextID != nil {
		nextCursor = nextTime.Format(time.RFC3339) + "|" + nextID.String()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": nextCursor,
	})
}

// Get returns a single item.
//
//	GET /api/v1/market/items/:itemID
func (h *CatalogHandler) Get(w http.ResponseWriter, r *http.Request) {
	itemID, err := uuid.Parse(chi.URLParam(r, "itemID"))
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid item ID", "INVALID_ID"))
		return
	}

	item, err := h.svc.Get(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, item)
}

// ListChapters returns all chapters for an item.
//
//	GET /api/v1/market/items/:itemID/chapters
func (h *CatalogHandler) ListChapters(w http.ResponseWriter, r *http.Request) {
	itemID, err := uuid.Parse(chi.URLParam(r, "itemID"))
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid item ID", "INVALID_ID"))
		return
	}

	chapters, err := h.svc.ListChapters(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"chapters": chapters,
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