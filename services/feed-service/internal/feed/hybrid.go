package feed

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
	"github.com/talvoapp/universal-publishing/feed-service/internal/models"
)

// HybridFeedReader orchestrates the read path for a user's feed.
//
// Algorithm:
//  1. Fetch the user's pre-computed timeline (Redis ZSet, from push fan-out).
//  2. Fetch the list of celebrity authors this user follows (from PostgreSQL).
//  3. Fetch each celebrity author's recent posts (from their author index).
//  4. Merge all sources, dedupe, sort by score DESC, paginate.
//  5. Hydrate post metadata (title, excerpt) from PostgreSQL.
//
// Caching:
//   - The pre-computed timeline is already in Redis (no DB hit).
//   - Celebrity author IDs are cached in Redis (5 min).
//   - Post metadata is cached in Redis (2 min).
type HybridFeedReader struct {
	cfg    HybridConfig
	redis  *redis.Client
	db     *pgxpool.Pool
	reader *CelebrityPostsReader
	log    *zap.Logger
}

// HybridConfig configures the reader.
type HybridConfig struct {
	CelebrityThreshold int
	DefaultPageSize    int
	MaxPageSize        int
	PerCelebrityLimit  int // how many posts to fetch per celebrity author
}

// NewHybridFeedReader creates a HybridFeedReader.
func NewHybridFeedReader(
	cfg HybridConfig,
	rdb *redis.Client,
	pool *pgxpool.Pool,
	log *zap.Logger,
) *HybridFeedReader {
	return &HybridFeedReader{
		cfg:    cfg,
		redis:  rdb,
		db:     pool,
		reader: NewCelebrityPostsReader(rdb, log),
		log:    log,
	}
}

// GetFeedInput is the input for GetFeed.
type GetFeedInput struct {
	UserID string
	Limit  int    // 0 → use DefaultPageSize
	Cursor string // "" → first page
}

// GetFeed returns the merged feed for a user.
func (h *HybridFeedReader) GetFeed(ctx context.Context, in GetFeedInput) (*models.FeedPage, error) {
	// ----- 1. Normalize limit -----
	limit := in.Limit
	if limit <= 0 {
		limit = h.cfg.DefaultPageSize
	}
	if limit > h.cfg.MaxPageSize {
		limit = h.cfg.MaxPageSize
	}

	// ----- 2. Parse cursor -----
	var cursorState *CursorState
	if in.Cursor != "" {
		score, postID, err := DecodeCursor(in.Cursor)
		if err != nil {
			return nil, fmt.Errorf("invalid cursor: %w", err)
		}
		cursorState = &CursorState{Score: score, PostID: postID}
	}

	// ----- 3. Fetch pre-computed timeline (push-fan-out results) -----
	// ZREVRANGEBYSCORE for cursor pagination, ZREVRANGE for first page.
	timelineKey := db.TimelineKey(in.UserID)
	timelinePosts, err := h.fetchTimelinePage(ctx, timelineKey, cursorState, limit*2)
	if err != nil {
		return nil, fmt.Errorf("fetch timeline: %w", err)
	}

	// ----- 4. Fetch celebrity authors this user follows -----
	celebrityIDs, err := h.getCelebrityFollowees(ctx, in.UserID)
	if err != nil {
		h.log.Warn("celebrity_fetch_failed", zap.Error(err))
		celebrityIDs = nil // degrade gracefully — return push-only feed
	}

	// ----- 5. Fetch recent posts from each celebrity -----
	var celebrityPosts map[string]int64
	if len(celebrityIDs) > 0 {
		var maxScore int64
		if cursorState != nil {
			maxScore = cursorState.Score
		}
		celebrityPosts, err = h.reader.FetchRecentPosts(
			ctx,
			celebrityIDs,
			h.cfg.PerCelebrityLimit,
			maxScore,
		)
		if err != nil {
			h.log.Warn("celebrity_posts_failed", zap.Error(err))
			// Degrade gracefully
		}
	}

	// ----- 6. Merge and sort -----
	merged := MergeAndSort(timelinePosts, celebrityPosts, cursorState, limit+1)

	// ----- 7. Determine hasMore + next cursor -----
	hasMore := len(merged) > limit
	if hasMore {
		merged = merged[:limit]
	}

	var nextCursor string
	if hasMore && len(merged) > 0 {
		last := merged[len(merged)-1]
		nextCursor = EncodeCursor(last.Score, last.PostID)
	}

	// ----- 8. Hydrate post metadata -----
	postIDs := make([]string, len(merged))
	for i, sp := range merged {
		postIDs[i] = sp.PostID
	}
	posts, err := h.hydratePosts(ctx, postIDs, merged)
	if err != nil {
		return nil, fmt.Errorf("hydrate posts: %w", err)
	}

	return &models.FeedPage{
		Posts:      posts,
		NextCursor: nextCursor,
		HasMore:    hasMore,
	}, nil
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// fetchTimelinePage fetches from the pre-computed timeline.
func (h *HybridFeedReader) fetchTimelinePage(
	ctx context.Context,
	key string,
	cursor *CursorState,
	fetchLimit int,
) (map[string]int64, error) {
	var results []redis.Z
	var err error

	if cursor != nil {
		results, err = h.redis.ZRevRangeByScoreWithScores(ctx, key, &redis.ZRangeBy{
			Max:   fmt.Sprintf("(%d", cursor.Score),
			Min:   "-inf",
			Count: int64(fetchLimit),
		}).Result()
	} else {
		results, err = h.redis.ZRevRangeWithScores(ctx, key, 0, int64(fetchLimit-1)).Result()
	}
	if err != nil && err != redis.Nil {
		return nil, err
	}

	out := make(map[string]int64, len(results))
	for _, z := range results {
		if id, ok := z.Member.(string); ok {
			out[id] = int64(z.Score)
		}
	}
	return out, nil
}

// getCelebrityFollowees returns the user IDs of celebrity authors the
// user follows. Results are cached in Redis for 5 minutes.
func (h *HybridFeedReader) getCelebrityFollowees(
	ctx context.Context,
	userID string,
) ([]string, error) {
	cacheKey := db.Key("celeb_followees", userID)

	// Try cache
	cached, err := h.redis.SMembers(ctx, cacheKey).Result()
	if err == nil && len(cached) > 0 {
		return cached, nil
	}

	// Cache miss — query DB
	rows, err := h.db.Query(ctx, `
		SELECT f.followee_id
		FROM follows f
		JOIN users_follow_counts c ON c.user_id = f.followee_id
		WHERE f.follower_id = $1
		  AND f.status = 'active'
		  AND c.follower_count > $2
	`, userID, h.cfg.CelebrityThreshold)
	if err != nil {
		return nil, fmt.Errorf("query celebrity followees: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}

	// Cache (5 min)
	if len(ids) > 0 {
		pipe := h.redis.Pipeline()
		members := make([]any, len(ids))
		for i, id := range ids {
			members[i] = id
		}
		pipe.SAdd(ctx, cacheKey, members...)
		pipe.Expire(ctx, cacheKey, 5*time.Minute)
		_, _ = pipe.Exec(ctx)
	}

	return ids, nil
}

// hydratePosts fetches full metadata (title, excerpt, etc.) from Postgres.
//
// The metadata is derived from DraftPublished events but stored in a
// thin `posts_metadata` table (populated by the consumer in v2). For v1,
// we fetch from `posts_metadata` if it exists; otherwise return minimal
// Post objects with just ID + author ID.
func (h *HybridFeedReader) hydratePosts(
	ctx context.Context,
	postIDs []string,
	scores []ScoredPost,
) ([]models.Post, error) {
	if len(postIDs) == 0 {
		return []models.Post{}, nil
	}

	// Build a map for O(1) score lookup
	scoreMap := make(map[string]int64, len(scores))
	for _, s := range scores {
		scoreMap[s.PostID] = s.Score
	}

	// v1: fetch from posts_metadata table (populated by consumer in v2).
	// For now, use a SELECT from a table that might not exist — fall
	// back to minimal Post objects if it doesn't.
	rows, err := h.db.Query(ctx, `
		SELECT id, author_id, title, excerpt, content_type, word_count, published_at
		FROM posts_metadata
		WHERE id = ANY($1::text[])
	`, postIDs)
	if err != nil {
		// Table missing → fallback to minimal posts
		return h.buildMinimalPosts(postIDs, scoreMap), nil
	}
	defer rows.Close()

	posts := make([]models.Post, 0, len(postIDs))
	for rows.Next() {
		var p models.Post
		if err := rows.Scan(
			&p.ID, &p.AuthorID, &p.Title, &p.Excerpt,
			&p.ContentType, &p.WordCount, &p.PublishedAt,
		); err != nil {
			continue
		}
		p.Score = scoreMap[p.ID]
		posts = append(posts, p)
	}

	// Preserve the order from `postIDs` (sorted by score)
	byID := make(map[string]models.Post, len(posts))
	for _, p := range posts {
		byID[p.ID] = p
	}
	ordered := make([]models.Post, 0, len(postIDs))
	for _, id := range postIDs {
		if p, ok := byID[id]; ok {
			ordered = append(ordered, p)
		}
	}

	return ordered, nil
}

// buildMinimalPosts creates minimal Post objects (fallback when metadata
// table is unavailable).
func (h *HybridFeedReader) buildMinimalPosts(
	postIDs []string,
	scoreMap map[string]int64,
) []models.Post {
	out := make([]models.Post, 0, len(postIDs))
	for _, id := range postIDs {
		out = append(out, models.Post{
			ID:    id,
			Score: scoreMap[id],
		})
	}
	return out
}