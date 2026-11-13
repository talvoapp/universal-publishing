package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/config"
	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
	"github.com/talvoapp/universal-publishing/feed-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/feed-service/internal/utils"
)

// FollowHandler handles follow/unfollow + listings.
type FollowHandler struct {
	cfg *config.Config
	db  *pgxpool.Pool
	log *zap.Logger
}

// NewFollowHandler creates a FollowHandler.
func NewFollowHandler(cfg *config.Config, db *pgxpool.Pool, log *zap.Logger) *FollowHandler {
	return &FollowHandler{cfg: cfg, db: db, log: log}
}

// ============================================================
// POST /api/v1/follow/{userID}
// ============================================================
func (h *FollowHandler) Follow(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	followeeID := chi.URLParam(r, "userID")
	if followeeID == "" {
		writeError(w, r, utils.BadRequest("Missing userID", "MISSING_USER_ID"))
		return
	}
	if followeeID == user.ID {
		writeError(w, r, utils.BadRequest("Cannot follow yourself", "SELF_FOLLOW"))
		return
	}

	err := db.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `
			INSERT INTO follows (follower_id, followee_id, status, created_at)
			VALUES ($1, $2, 'active', now())
			ON CONFLICT (follower_id, followee_id) DO NOTHING
		`, user.ID, followeeID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}

		if _, err := tx.Exec(r.Context(), `
			INSERT INTO users_follow_counts (user_id, follower_count, following_count)
			VALUES ($1, 1, 0)
			ON CONFLICT (user_id) DO UPDATE
				SET follower_count = users_follow_counts.follower_count + 1,
				    updated_at = now()
		`, followeeID); err != nil {
			return err
		}

		if _, err := tx.Exec(r.Context(), `
			INSERT INTO users_follow_counts (user_id, follower_count, following_count)
			VALUES ($1, 0, 1)
			ON CONFLICT (user_id) DO UPDATE
				SET following_count = users_follow_counts.following_count + 1,
				    updated_at = now()
		`, user.ID); err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		h.log.Error("follow_failed",
			zap.Error(err),
			zap.String("user_id", user.ID),
			zap.String("followee_id", followeeID),
		)
		writeError(w, r, utils.Internal("Failed to follow", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// DELETE /api/v1/follow/{userID}
// ============================================================
func (h *FollowHandler) Unfollow(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	followeeID := chi.URLParam(r, "userID")
	if followeeID == "" {
		writeError(w, r, utils.BadRequest("Missing userID", "MISSING_USER_ID"))
		return
	}

	err := db.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		tag, err := tx.Exec(r.Context(), `
			DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2
		`, user.ID, followeeID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return nil
		}

		if _, err := tx.Exec(r.Context(), `
			UPDATE users_follow_counts
			SET follower_count = GREATEST(0, follower_count - 1),
			    updated_at = now()
			WHERE user_id = $1
		`, followeeID); err != nil {
			return err
		}

		if _, err := tx.Exec(r.Context(), `
			UPDATE users_follow_counts
			SET following_count = GREATEST(0, following_count - 1),
			    updated_at = now()
			WHERE user_id = $1
		`, user.ID); err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		h.log.Error("unfollow_failed",
			zap.Error(err),
			zap.String("user_id", user.ID),
			zap.String("followee_id", followeeID),
		)
		writeError(w, r, utils.Internal("Failed to unfollow", err))
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============================================================
// GET /api/v1/follow/followers (current user's followers)
// ============================================================
func (h *FollowHandler) ListFollowers(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	limit := parseIntQuery(r, "limit", 100)
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT follower_id, created_at
		FROM follows
		WHERE followee_id = $1 AND status = 'active'
		ORDER BY created_at DESC
		LIMIT $2
	`, user.ID, limit)
	if err != nil {
		h.log.Error("list_followers_failed", zap.Error(err), zap.String("user_id", user.ID))
		writeError(w, r, utils.Internal("Failed to load followers", err))
		return
	}
	defer rows.Close()

	followers := make([]map[string]any, 0, limit)
	for rows.Next() {
		var followerID string
		var createdAt any
		if err := rows.Scan(&followerID, &createdAt); err != nil {
			continue
		}
		followers = append(followers, map[string]any{
			"userId":     followerID,
			"followedAt": createdAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"followers": followers,
		"count":     len(followers),
	})
}

// ============================================================
// GET /api/v1/follow/following (current user's following)
// ============================================================
func (h *FollowHandler) ListFollowing(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	limit := parseIntQuery(r, "limit", 100)
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT followee_id, created_at
		FROM follows
		WHERE follower_id = $1 AND status = 'active'
		ORDER BY created_at DESC
		LIMIT $2
	`, user.ID, limit)
	if err != nil {
		h.log.Error("list_following_failed", zap.Error(err), zap.String("user_id", user.ID))
		writeError(w, r, utils.Internal("Failed to load following", err))
		return
	}
	defer rows.Close()

	following := make([]map[string]any, 0, limit)
	for rows.Next() {
		var followeeID string
		var createdAt any
		if err := rows.Scan(&followeeID, &createdAt); err != nil {
			continue
		}
		following = append(following, map[string]any{
			"userId":     followeeID,
			"followedAt": createdAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"following": following,
		"count":     len(following),
	})
}

// ============================================================
// GET /api/v1/follows/{userID}/followers (PUBLIC — for internal service calls)
//
// Used by notification-service to fetch follower IDs of an author
// when handling DraftPublished events. Returns a compact list of IDs
// (no timestamps, no profile data) to minimize payload.
//
// Response:
//   {
//     "followerIds": ["uuid1", "uuid2", ...],
//     "count": 2
//   }
// ============================================================
func (h *FollowHandler) ListUserFollowers(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "userID")
	if targetUserID == "" {
		writeError(w, r, utils.BadRequest("Missing userID", "MISSING_USER_ID"))
		return
	}

	limit := parseIntQuery(r, "limit", 1000)
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT follower_id
		FROM follows
		WHERE followee_id = $1 AND status = 'active'
		ORDER BY created_at DESC
		LIMIT $2
	`, targetUserID, limit)
	if err != nil {
		h.log.Error("list_user_followers_failed",
			zap.Error(err),
			zap.String("user_id", targetUserID),
		)
		writeError(w, r, utils.Internal("Failed to load followers", err))
		return
	}
	defer rows.Close()

	followerIds := make([]string, 0, limit)
	for rows.Next() {
		var followerID string
		if err := rows.Scan(&followerID); err != nil {
			continue
		}
		followerIds = append(followerIds, followerID)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"followerIds": followerIds,
		"count":       len(followerIds),
	})
}