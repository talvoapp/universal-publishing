// Package handlers implements HTTP handlers for content-service.
//
// FILE ORGANIZATION:
//   - content.go  — constructor + metadata + chapters + shared helpers
//   - preview.go  — public preview endpoints (truncated excerpts)
//   - read.go     — gated read endpoints (entitlement enforced)
//   - health.go   — liveness endpoint
package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/config"
	"github.com/talvoapp/universal-publishing/content-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/content-service/internal/services"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// ContentHandler handles all content read endpoints.
type ContentHandler struct {
	cfg     *config.Config
	content *services.ContentService
	db      *pgxpool.Pool
	log     *zap.Logger
}

// NewContentHandler creates a ContentHandler.
func NewContentHandler(
	cfg *config.Config,
	pgPool *pgxpool.Pool,
	mongoDB *mongo.Client,
	rdb *redis.Client,
	log *zap.Logger,
) *ContentHandler {
	dbName := cfg.MongoDBName
	mongoDatabase := mongoDB.Database(dbName)
	return &ContentHandler{
		cfg:     cfg,
		content: services.NewContentService(cfg, mongoDatabase, log),
		db:      pgPool,
		log:     log,
	}
}

// ============================================================
// METADATA (public, no entitlement needed)
// ============================================================

// GetMetadata returns item summary (title, cover, tags, word count).
//
//	GET /api/v1/content/{itemID}/metadata
func (h *ContentHandler) GetMetadata(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	if itemID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID", "MISSING_ITEM_ID"))
		return
	}

	article, err := h.content.GetArticle(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	summary := services.BuildSummaryFromArticle(article)
	writeJSON(w, http.StatusOK, summary)
}

// ListChapters returns the table of contents.
//
//	GET /api/v1/content/{itemID}/chapters
func (h *ContentHandler) ListChapters(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	if itemID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID", "MISSING_ITEM_ID"))
		return
	}

	article, err := h.content.GetArticle(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	freeIndices := h.getFreeChapters(r, itemID)
	summaries := h.content.ListChapterSummaries(article, freeIndices)

	writeJSON(w, http.StatusOK, map[string]any{
		"itemId":   article.ID.Hex(),
		"title":    article.Title,
		"chapters": summaries,
	})
}

// ============================================================
// HELPERS
// ============================================================

func (h *ContentHandler) getFreeChapters(r *http.Request, itemID string) []int {
	var freeArr []int32
	err := h.db.QueryRow(r.Context(),
		`SELECT free_chapters FROM items WHERE id = $1`, itemID,
	).Scan(&freeArr)
	if err != nil {
		return nil
	}
	out := make([]int, len(freeArr))
	for i, v := range freeArr {
		out[i] = int(v)
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, err error) {
	reqID := middleware.RequestIDFromContext(r.Context())
	utils.AsAppError(err).Write(w, reqID)
}