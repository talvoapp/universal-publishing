// Package handlers implements HTTP handlers for content-service.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

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
	db      *pgxpool.Pool // for chapter free-list lookup
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

	// Build summary (no content exposed)
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

	// Fetch free chapters from marketplace DB
	freeIndices := h.getFreeChapters(r, itemID)

	summaries := h.content.ListChapterSummaries(article, freeIndices)
	writeJSON(w, http.StatusOK, map[string]any{
		"itemId":   article.ID.Hex(),
		"title":    article.Title,
		"chapters": summaries,
	})
}

// ============================================================
// PREVIEWS (public, no entitlement needed)
// ============================================================

// GetPreview returns the free preview (first PREVIEW_FRACTION of content).
//
//	GET /api/v1/content/{itemID}/preview
func (h *ContentHandler) GetPreview(w http.ResponseWriter, r *http.Request) {
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

	preview := h.content.BuildPreview(article)
	// Cache briefly at CDN (1 min) — previews are identical for all users
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, preview)
}

// GetChapterPreview returns a chapter's free preview.
//
//	GET /api/v1/content/{itemID}/chapters/{chapterID}/preview
func (h *ContentHandler) GetChapterPreview(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	chapterID := chi.URLParam(r, "chapterID")
	if itemID == "" || chapterID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID or chapterID", "MISSING_PARAM"))
		return
	}

	chapterIndex, err := strconv.Atoi(chapterID)
	if err != nil || chapterIndex < 1 {
		writeError(w, r, utils.BadRequest("Invalid chapterID", "INVALID_CHAPTER_ID"))
		return
	}

	article, chapter, err := h.content.GetChapter(r.Context(), itemID, chapterIndex)
	if err != nil {
		writeError(w, r, err)
		return
	}

	preview := h.content.BuildChapterPreview(article, chapter, chapterID)
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, preview)
}

// ============================================================
// FULL READS (entitlement enforced by middleware)
// ============================================================

// ReadFullItem returns the full article content.
//
//	GET /api/v1/content/{itemID}/read
//
// Gated by EntitlementMiddleware. If the request reaches this handler,
// the user has already been verified as entitled.
func (h *ContentHandler) ReadFullItem(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	if itemID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID", "MISSING_ITEM_ID"))
		return
	}

	// Retrieve entitlement type from context (set by middleware)
	ent := middleware.EntitlementFromContext(r.Context())
	entType := "unknown"
	if ent != nil {
		entType = string(ent.Type)
	}

	article, err := h.content.GetArticle(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	full := h.content.BuildFullContent(article, entType)

	// CRITICAL: gated content MUST NOT be cached by CDN or browser
	w.Header().Set("Cache-Control", "private, no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")

	writeJSON(w, http.StatusOK, full)
}

// ReadChapter returns the full content of a specific chapter.
//
//	GET /api/v1/content/{itemID}/chapters/{chapterID}/read
func (h *ContentHandler) ReadChapter(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	chapterID := chi.URLParam(r, "chapterID")
	if itemID == "" || chapterID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID or chapterID", "MISSING_PARAM"))
		return
	}

	chapterIndex, err := strconv.Atoi(chapterID)
	if err != nil || chapterIndex < 1 {
		writeError(w, r, utils.BadRequest("Invalid chapterID", "INVALID_CHAPTER_ID"))
		return
	}

	ent := middleware.EntitlementFromContext(r.Context())
	entType := "unknown"
	if ent != nil {
		entType = string(ent.Type)
	}

	article, chapter, err := h.content.GetChapter(r.Context(), itemID, chapterIndex)
	if err != nil {
		writeError(w, r, err)
		return
	}

	full := h.content.BuildFullChapter(article, chapter, chapterID, entType)

	w.Header().Set("Cache-Control", "private, no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")

	writeJSON(w, http.StatusOK, full)
}

// ============================================================
// HELPERS
// ============================================================

// getFreeChapters fetches the free chapter indices for an item from the
// marketplace DB (items.free_chapters column).
func (h *ContentHandler) getFreeChapters(r *http.Request, itemID string) []int {
	var freeArr []int32
	err := h.db.QueryRow(r.Context(),
		`SELECT free_chapters FROM items WHERE id = $1`, itemID,
	).Scan(&freeArr)
	if err != nil {
		// Item not in marketplace DB (perhaps unpublished) — no free chapters
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