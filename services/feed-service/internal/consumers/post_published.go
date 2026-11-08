package consumers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
)

// DraftPublishedPayload is the shape of the `DraftPublished` event
// payload emitted by editor-service.
type DraftPublishedPayload struct {
	DraftID     string   `json:"draftId"`
	OwnerID     string   `json:"ownerId"`
	Title       string   `json:"title"`
	ContentType string   `json:"contentType"`
	WordCount   int      `json:"wordCount"`
	PublishedAt string   `json:"publishedAt"`
	Excerpt     string   `json:"excerpt"`
	Tags        []string `json:"tags"`
}

// HandleDraftPublished processes a `DraftPublished` event.
//
// FLOW:
//   1. Parse payload.
//   2. Fetch the author's follower count.
//   3. Determine push vs pull (based on celebrityThreshold).
//   4. Write to author's own timeline + author's own index.
//   5. If push: fan out to every follower's timeline.
//      If pull: no fan-out (readers fetch from author index).
//   6. (v2) Upsert `posts_metadata` row for feed hydration.
//
// This function is called from `internal/consumer.handleDraftPublished`.
// It is exposed here so that it can be unit-tested independently of
// the Kafka plumbing.
func HandleDraftPublished(
	ctx context.Context,
	pool *pgxpool.Pool,
	pusher *feed.Pusher,
	log *zap.Logger,
	celebrityThreshold int,
	evtID string,
	occurredAt time.Time,
	payloadJSON []byte,
) error {
	// ----- 1. Parse payload -----
	var payload DraftPublishedPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return fmt.Errorf("unmarshal DraftPublished payload: %w", err)
	}
	if payload.DraftID == "" || payload.OwnerID == "" {
		return fmt.Errorf("missing draftId or ownerId in DraftPublished payload")
	}

	// ----- 2. Determine score (publish time) -----
	// Use the event's occurredAt, falling back to payload.publishedAt
	// if the envelope's timestamp is suspiciously old.
	publishedAt := occurredAt
	if payload.PublishedAt != "" {
		if t, err := time.Parse(time.RFC3339, payload.PublishedAt); err == nil {
			publishedAt = t
		}
	}
	score := publishedAt.Unix()

	// ----- 3. Fetch author's follower count -----
	var followerCount int
	err := pool.QueryRow(ctx, `
		SELECT follower_count FROM users_follow_counts WHERE user_id = $1
	`, payload.OwnerID).Scan(&followerCount)
	if err != nil {
		// No row → author is brand new (0 followers)
		followerCount = 0
	}

	isCelebrity := followerCount > celebrityThreshold

	log.Info("draft_published",
		zap.String("event_id", evtID),
		zap.String("draft_id", payload.DraftID),
		zap.String("owner_id", payload.OwnerID),
		zap.Int("follower_count", followerCount),
		zap.Bool("is_celebrity", isCelebrity),
		zap.Int64("score", score),
	)

	// ----- 4. ALWAYS write to author index + own timeline -----
	if err := pusher.AppendToAuthorIndex(ctx, payload.OwnerID, payload.DraftID, score); err != nil {
		return fmt.Errorf("append to author index: %w", err)
	}
	if err := pusher.AppendToTimeline(ctx, payload.OwnerID, payload.DraftID, score); err != nil {
		return fmt.Errorf("append to own timeline: %w", err)
	}

	// ----- 5. Fan out (push) or not (pull) -----
	if isCelebrity {
		log.Debug("celebrity_pull_path_used",
			zap.String("owner_id", payload.OwnerID),
			zap.Int("followers", followerCount),
		)
		return nil
	}

	result, err := pusher.FanoutToFollowers(ctx, payload.DraftID, payload.OwnerID, score)
	if err != nil {
		return fmt.Errorf("fanout: %w", err)
	}

	log.Info("push_fanout_complete",
		zap.String("draft_id", payload.DraftID),
		zap.String("owner_id", payload.OwnerID),
		zap.Int("notified", result.FollowersNotified),
	)

	return nil
}