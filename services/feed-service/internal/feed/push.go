// Package feed — push path helpers.
//
// The consumer (Kafka DraftPublished handler) needs two low-level
// operations:
//
//   1. appendToTimeline — ZADD + trim to a single key
//   2. fanoutToFollowers — pipeline of ZADDs across N follower keys
//
// Both are moved here (out of the consumer) so that they can be:
//   - Unit tested without Kafka
//   - Reused by other services (e.g., admin tools that need to
//     force-rebuild a timeline)
//   - Optimized independently (e.g., switch from pipeline to Lua
//     script if needed)
package feed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
)

// Pusher encapsulates the write-side operations of the hybrid fan-out.
type Pusher struct {
	redis           *redis.Client
	db              *pgxpool.Pool
	log             *zap.Logger
	timelineMaxSize int
	fanoutCap       int
}

// PusherConfig configures the Pusher.
type PusherConfig struct {
	Redis           *redis.Client
	DB              *pgxpool.Pool
	Logger          *zap.Logger
	TimelineMaxSize int
	FanoutCap       int
}

// NewPusher creates a Pusher.
func NewPusher(cfg PusherConfig) *Pusher {
	if cfg.TimelineMaxSize <= 0 {
		cfg.TimelineMaxSize = 1000
	}
	if cfg.FanoutCap <= 0 {
		cfg.FanoutCap = 10000
	}
	return &Pusher{
		redis:           cfg.Redis,
		db:              cfg.DB,
		log:             cfg.Logger,
		timelineMaxSize: cfg.TimelineMaxSize,
		fanoutCap:       cfg.FanoutCap,
	}
}

// ============================================================
// LOW-LEVEL: append to a single timeline
// ============================================================

// Append adds a post to a single timeline (ZSet) and trims to cap.
//
// Idempotent — if the post is already in the timeline, the score is
// updated (which is a no-op if the score is unchanged).
func (p *Pusher) Append(ctx context.Context, key, postID string, score int64) error {
	pipe := p.redis.Pipeline()
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(score), Member: postID})
	pipe.ZRemRangeByRank(ctx, key, 0, int64(-p.timelineMaxSize-1))
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("append to %s: %w", key, err)
	}
	return nil
}

// AppendToTimeline is the public version — takes (userID, postID, score)
// and writes to the user's personal timeline.
func (p *Pusher) AppendToTimeline(ctx context.Context, userID, postID string, score int64) error {
	return p.Append(ctx, db.TimelineKey(userID), postID, score)
}

// AppendToAuthorIndex writes to the author's own index (used for pull).
func (p *Pusher) AppendToAuthorIndex(ctx context.Context, authorID, postID string, score int64) error {
	return p.Append(ctx, db.AuthorPostsKey(authorID), postID, score)
}

// ============================================================
// FANOUT: write to many follower timelines
// ============================================================

// FanoutResult summarizes a fan-out operation.
type FanoutResult struct {
	FollowersNotified int
	FollowersSkipped  int // due to cap
}

// FanoutToFollowers writes the post to every active follower's timeline.
//
// Uses a Redis pipeline — one RTT for N writes (up to thousands).
// Batches in groups of 500 to avoid huge pipelines (memory + latency).
func (p *Pusher) FanoutToFollowers(
	ctx context.Context,
	postID, authorID string,
	score int64,
) (*FanoutResult, error) {
	// Fetch followers (bounded by fanoutCap)
	rows, err := p.db.Query(ctx, `
		SELECT follower_id
		FROM follows
		WHERE followee_id = $1 AND status = 'active'
		LIMIT $2
	`, authorID, p.fanoutCap)
	if err != nil {
		return nil, fmt.Errorf("fetch followers: %w", err)
	}
	defer rows.Close()

	result := &FanoutResult{}
	batchSize := 500
	batch := make([]string, 0, batchSize)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		pipe := p.redis.Pipeline()
		for _, followerID := range batch {
			key := db.TimelineKey(followerID)
			pipe.ZAdd(ctx, key, redis.Z{Score: float64(score), Member: postID})
			pipe.ZRemRangeByRank(ctx, key, 0, int64(-p.timelineMaxSize-1))
		}
		if _, err := pipe.Exec(ctx); err != nil {
			return fmt.Errorf("pipeline exec: %w", err)
		}
		result.FollowersNotified += len(batch)
		batch = batch[:0]
		return nil
	}

	for rows.Next() {
		var followerID string
		if err := rows.Scan(&followerID); err != nil {
			continue
		}
		batch = append(batch, followerID)
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return result, err
			}
		}
	}
	if err := flush(); err != nil {
		return result, err
	}

	p.log.Info("fanout_complete",
		zap.String("post_id", postID),
		zap.String("author_id", authorID),
		zap.Int("followers_notified", result.FollowersNotified),
	)

	return result, nil
}

// ============================================================
// TRIMMING (maintenance — used by scheduled jobs)
// ============================================================

// TrimTimeline enforces the max size on a single timeline.
// Useful for periodic cleanup if the pipeline trims get skipped.
func (p *Pusher) TrimTimeline(ctx context.Context, userID string) error {
	key := db.TimelineKey(userID)
	return p.redis.ZRemRangeByRank(ctx, key, 0, int64(-p.timelineMaxSize-1)).Err()
}