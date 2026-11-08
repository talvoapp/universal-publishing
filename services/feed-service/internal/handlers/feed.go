// Package handlers implements HTTP handlers for feed-service.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/config"
	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
	"github.com/talvoapp/universal-publishing/feed-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/feed-service/internal/utils"
)

// FeedHandler serves feed read endpoints.
type FeedHandler struct {
	cfg    *config.Config
	reader *feed.HybridFeedReader
	db     *pgxpool.Pool
	redis  *redis.Client
	log    *zap.Logger
}

// NewFeedHandler creates a FeedHandler.
func NewFeedHandler(cfg *config.Config, db *pgxpool.Pool, rdb *redis.Client, log *zap.Logger) *FeedHandler {
	reader := feed.NewHybridFeedReader(feed.HybridConfig{
		CelebrityThreshold: cfg.CelebrityThreshold,
		DefaultPageSize:    cfg.DefaultPageSize,
		MaxPageSize:        cfg.MaxPageSize,
		PerCelebrityLimit:  5, // top 5 posts per celebrity per read
	}, rdb, db, log)

	return &FeedHandler{
		cfg:    cfg,
		reader: reader,
		db:     db,
		redis:  rdb,
		log:    log,
	}
}

// ============================================================
// GET /api/v1/feed
// Returns the current user's feed.
// ============================================================
func (h *FeedHandler) GetMyFeed(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	limit := parseIntQuery(r, "limit", 0)
	cursor := r.URL.Query().Get("cursor")

	page, err := h.reader.GetFeed(r.Context(), feed.GetFeedInput{
		UserID: user.ID,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		h.log.Error("get_feed_failed", zap.Error(err), zap.String("user_id", user.ID))
		writeError(w, r, utils.Internal("Failed to load feed", err))
		return
	}

	writeJSON(w, http.StatusOK, page)
}

// ============================================================
// GET /api/v1/feed/user/{userID}
// Returns a specific user's feed (public view).
// ============================================================
func (h *FeedHandler) GetUserFeed(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "userID")
	if targetUserID == "" {
		writeError(w, r, utils.BadRequest("Missing userID", "MISSING_USER_ID"))
		return
	}

	limit := parseIntQuery(r, "limit", 0)
	cursor := r.URL.Query().Get("cursor")

	page, err := h.reader.GetFeed(r.Context(), feed.GetFeedInput{
		UserID: targetUserID,
		Limit:  limit,
		Cursor: cursor,
	})
	if err != nil {
		h.log.Error("get_user_feed_failed", zap.Error(err), zap.String("user_id", targetUserID))
		writeError(w, r, utils.Internal("Failed to load feed", err))
		return
	}

	writeJSON(w, http.StatusOK, page)
}

// ============================================================
// GET /api/v1/feed/author/{authorID}
// Returns posts by a specific author (their own Redis index).
// ============================================================
func (h *FeedHandler) GetAuthorPosts(w http.ResponseWriter, r *http.Request) {
	authorID := chi.URLParam(r, "authorID")
	if authorID == "" {
		writeError(w, r, utils.BadRequest("Missing authorID", "MISSING_AUTHOR_ID"))
		return
	}

	limit := parseIntQuery(r, "limit", h.cfg.DefaultPageSize)
	if limit <= 0 {
		limit = h.cfg.DefaultPageSize
	}
	if limit > h.cfg.MaxPageSize {
		limit = h.cfg.MaxPageSize
	}

	posts, err := h.getAuthorPosts(r, authorID, limit)
	if err != nil {
		h.log.Error("get_author_posts_failed", zap.Error(err), zap.String("author_id", authorID))
		writeError(w, r, utils.Internal("Failed to load author posts", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"authorId": authorID,
		"posts":    posts,
	})
}

// getAuthorPosts fetches an author's posts from their Redis Sorted Set.
//
// The author index is maintained by the Kafka consumer on every
// DraftPublished event — it contains ALL posts the author has published,
// regardless of whether they're a "celebrity" or not.
//
// This endpoint is what clients call to see "all posts by @user".
func (h *FeedHandler) getAuthorPosts(r *http.Request, authorID string, limit int) ([]map[string]any, error) {
	key := db.AuthorPostsKey(authorID)

	results, err := h.redis.ZRevRangeWithScores(r.Context(), key, 0, int64(limit-1)).Result()
	if err != nil && err != redis.Nil {
		return nil, err
	}

	posts := make([]map[string]any, 0, len(results))
	for _, z := range results {
		id, ok := z.Member.(string)
		if !ok {
			continue
		}
		posts = append(posts, map[string]any{
			"id":          id,
			"score":       int64(z.Score),
			"publishedAt": int64(z.Score), // unix seconds — convenient for clients
		})
	}
	return posts, nil
}

// ------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------

// parseIntQuery parses an integer query param, falling back to `def`
// on parse errors or negative values.
func parseIntQuery(r *http.Request, key string, def int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return def
	}
	return n
}

// writeJSON writes a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError serializes an AppError as an RFC 7807 response.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	reqID := middleware.RequestIDFromContext(r.Context())
	utils.AsAppError(err).Write(w, reqID)
}