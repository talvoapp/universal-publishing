package feed

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
)

// CelebrityPostsReader fetches recent posts from authors the user follows
// who are marked as "celebrity" (follower_count > threshold).
//
// At read time, we merge:
//   (a) the pre-computed timeline (from normal authors, via push)
//   (b) the recent posts of celebrity authors (fetched here)
//
// We limit each celebrity to `perAuthorLimit` posts. This bounds the
// cost: O(celebrities × perAuthorLimit) reads.
type CelebrityPostsReader struct {
	redis *redis.Client
	log   *zap.Logger
}

// NewCelebrityPostsReader creates a reader.
func NewCelebrityPostsReader(rdb *redis.Client, log *zap.Logger) *CelebrityPostsReader {
	return &CelebrityPostsReader{redis: rdb, log: log}
}

// FetchRecentPosts fetches the recent post IDs (score + id) for a set
// of celebrity authors, up to perAuthorLimit per author, bounded by
// maxScore (for pagination — don't return items newer than this).
//
// Returns a map of {postID → score}. Duplicates (same post appearing
// under multiple authors — impossible in practice but defensive) are
// collapsed by the caller.
func (r *CelebrityPostsReader) FetchRecentPosts(
	ctx context.Context,
	celebrityIDs []string,
	perAuthorLimit int,
	maxScore int64, // 0 = no bound
) (map[string]int64, error) {
	if len(celebrityIDs) == 0 {
		return nil, nil
	}

	// Measure actual elapsed time for the debug log below.
	start := time.Now()

	// Use a pipeline for efficiency — 1 RTT for N ZREVRANGEBYSCORE calls.
	pipe := r.redis.Pipeline()

	type pending struct {
		authorID string
		cmd      *redis.ZSliceCmd
	}
	cmds := make([]pending, 0, len(celebrityIDs))

	for _, authorID := range celebrityIDs {
		key := db.AuthorPostsKey(authorID)
		var cmd *redis.ZSliceCmd
		if maxScore > 0 {
			// Paginated: only fetch older than maxScore
			cmd = pipe.ZRevRangeByScoreWithScores(ctx, key, &redis.ZRangeBy{
				Max:   fmt.Sprintf("(%d", maxScore), // exclusive
				Min:   "-inf",
				Count: int64(perAuthorLimit),
			})
		} else {
			// First page: fetch most recent
			cmd = pipe.ZRevRangeWithScores(ctx, key, 0, int64(perAuthorLimit-1))
		}
		cmds = append(cmds, pending{authorID: authorID, cmd: cmd})
	}

	if _, err := pipe.Exec(ctx); err != nil && err != redis.Nil {
		return nil, fmt.Errorf("pipeline exec: %w", err)
	}

	// Collect results
	out := make(map[string]int64)
	for _, p := range cmds {
		posts, err := p.cmd.Result()
		if err != nil {
			r.log.Warn("celebrity_fetch_failed",
				zap.Error(err),
				zap.String("author_id", p.authorID),
			)
			continue
		}
		for _, z := range posts {
			postID, ok := z.Member.(string)
			if !ok {
				continue
			}
			// Take the maximum score (in case of duplicate across authors —
			// shouldn't happen but defensive).
			score := int64(z.Score)
			if existing, ok := out[postID]; !ok || score > existing {
				out[postID] = score
			}
		}
	}

	// FIX: use the captured `start` instead of `time.Now()` (which
	// would always yield ~0). Reported elapsed time is now accurate.
	r.log.Debug("celebrity_posts_fetched",
		zap.Int("authors", len(celebrityIDs)),
		zap.Int("posts", len(out)),
		zap.Duration("elapsed", time.Since(start)),
	)

	return out, nil
}