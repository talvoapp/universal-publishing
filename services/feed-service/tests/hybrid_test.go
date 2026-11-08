//go:build integration

package tests

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/talvoapp/universal-publishing/feed-service/internal/consumers"
	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
)

// ============================================================
// HYBRID FAN-OUT INTEGRATION TESTS
// ============================================================

func TestHybrid_PushFanout_NormalUser(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	follower1 := uuid.NewString()
	follower2 := uuid.NewString()
	follower3 := uuid.NewString()

	for _, f := range []string{follower1, follower2, follower3} {
		_, err := env.DB.Exec(env.Ctx, `
			INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'active')
		`, f, authorID)
		if err != nil {
			t.Fatalf("insert follow: %v", err)
		}
	}
	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO users_follow_counts (user_id, follower_count, following_count)
		VALUES ($1, 3, 0)
	`, authorID)
	if err != nil {
		t.Fatalf("insert count: %v", err)
	}

	pusher := consumers.NewPusher(env.DB, env.Redis, env.Log, 1000, 10000)
	postID := uuid.NewString()

	err = consumers.HandleDraftPublished(
		env.Ctx, env.DB, pusher, env.Log, 1000,
		uuid.NewString(), time.Now(),
		mustMarshal(t, consumers.DraftPublishedPayload{
			DraftID:     postID,
			OwnerID:     authorID,
			Title:       "Test Post",
			ContentType: "article",
			PublishedAt: time.Now().UTC().Format(time.RFC3339),
		}),
	)
	if err != nil {
		t.Fatalf("HandleDraftPublished: %v", err)
	}

	// Verify: post is in author's + all 3 followers' timelines
	for _, userID := range []string{authorID, follower1, follower2, follower3} {
		key := "feed:timeline:" + userID
		if _, err := env.Redis.ZScore(env.Ctx, key, postID).Result(); err != nil {
			t.Errorf("user %s missing post in timeline: %v", userID, err)
		}
	}
}

func TestHybrid_PullPath_Celebrity(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	follower1 := uuid.NewString()
	follower2 := uuid.NewString()

	for _, f := range []string{follower1, follower2} {
		_, err := env.DB.Exec(env.Ctx, `
			INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'active')
		`, f, authorID)
		if err != nil {
			t.Fatalf("insert follow: %v", err)
		}
	}
	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO users_follow_counts (user_id, follower_count, following_count)
		VALUES ($1, 5000, 0)
	`, authorID)
	if err != nil {
		t.Fatalf("insert count: %v", err)
	}

	pusher := consumers.NewPusher(env.DB, env.Redis, env.Log, 1000, 10000)
	postID := uuid.NewString()

	err = consumers.HandleDraftPublished(
		env.Ctx, env.DB, pusher, env.Log, 1000,
		uuid.NewString(), time.Now(),
		mustMarshal(t, consumers.DraftPublishedPayload{
			DraftID:     postID,
			OwnerID:     authorID,
			Title:       "Celebrity Post",
			ContentType: "article",
			PublishedAt: time.Now().UTC().Format(time.RFC3339),
		}),
	)
	if err != nil {
		t.Fatalf("HandleDraftPublished: %v", err)
	}

	// Author's own timeline
	authorTimelineKey := "feed:timeline:" + authorID
	if _, err := env.Redis.ZScore(env.Ctx, authorTimelineKey, postID).Result(); err != nil {
		t.Errorf("author's own timeline missing post: %v", err)
	}

	// Author's index
	authorIndexKey := "feed:author:" + authorID
	if _, err := env.Redis.ZScore(env.Ctx, authorIndexKey, postID).Result(); err != nil {
		t.Errorf("author index missing post: %v", err)
	}

	// NOT in followers' timelines
	for _, userID := range []string{follower1, follower2} {
		key := "feed:timeline:" + userID
		_, err := env.Redis.ZScore(env.Ctx, key, postID).Result()
		if err != redis.Nil {
			t.Errorf("celebrity post should NOT be fanned out to %s (err=%v)", userID, err)
		}
	}
}

func TestHybrid_FeedMergesCelebrityAndNormal(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	reader := uuid.NewString()
	normalAuthor := uuid.NewString()
	celebrityAuthor := uuid.NewString()

	for _, author := range []string{normalAuthor, celebrityAuthor} {
		_, err := env.DB.Exec(env.Ctx, `
			INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'active')
		`, reader, author)
		if err != nil {
			t.Fatalf("insert follow: %v", err)
		}
	}
	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO users_follow_counts (user_id, follower_count, following_count)
		VALUES ($1, 10, 0), ($2, 5000, 0)
	`, normalAuthor, celebrityAuthor)
	if err != nil {
		t.Fatalf("insert counts: %v", err)
	}

	pusher := consumers.NewPusher(env.DB, env.Redis, env.Log, 1000, 10000)
	normalPostID := uuid.NewString()
	celebrityPostID := uuid.NewString()
	now := time.Now()

	_ = consumers.HandleDraftPublished(
		env.Ctx, env.DB, pusher, env.Log, 1000,
		uuid.NewString(), now.Add(-2*time.Minute),
		mustMarshal(t, consumers.DraftPublishedPayload{
			DraftID: normalPostID, OwnerID: normalAuthor,
			PublishedAt: now.Add(-2 * time.Minute).UTC().Format(time.RFC3339),
		}),
	)
	_ = consumers.HandleDraftPublished(
		env.Ctx, env.DB, pusher, env.Log, 1000,
		uuid.NewString(), now.Add(-1*time.Minute),
		mustMarshal(t, consumers.DraftPublishedPayload{
			DraftID: celebrityPostID, OwnerID: celebrityAuthor,
			PublishedAt: now.Add(-1 * time.Minute).UTC().Format(time.RFC3339),
		}),
	)

	// Reader's feed
	hybridReader := feed.NewHybridFeedReader(
		feed.HybridConfig{
			CelebrityThreshold: 1000,
			DefaultPageSize:    20,
			MaxPageSize:        50,
			PerCelebrityLimit:  5,
		},
		env.Redis, env.DB, env.Log,
	)

	page, err := hybridReader.GetFeed(context.Background(), feed.GetFeedInput{
		UserID: reader, Limit: 20,
	})
	if err != nil {
		t.Fatalf("GetFeed: %v", err)
	}

	foundNormal, foundCelebrity := false, false
	for _, p := range page.Posts {
		if p.ID == normalPostID {
			foundNormal = true
		}
		if p.ID == celebrityPostID {
			foundCelebrity = true
		}
	}
	if !foundNormal {
		t.Errorf("feed missing normal post")
	}
	if !foundCelebrity {
		t.Errorf("feed missing celebrity post (pulled at read time)")
	}
}

func TestHybrid_NoCelebrityFollows(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	reader := uuid.NewString()
	authorID := uuid.NewString()

	_, _ = env.DB.Exec(env.Ctx, `
		INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'active')
	`, reader, authorID)
	_, _ = env.DB.Exec(env.Ctx, `
		INSERT INTO users_follow_counts (user_id, follower_count, following_count)
		VALUES ($1, 10, 0)
	`, authorID)

	pusher := consumers.NewPusher(env.DB, env.Redis, env.Log, 1000, 10000)
	postID := uuid.NewString()

	_ = consumers.HandleDraftPublished(
		env.Ctx, env.DB, pusher, env.Log, 1000,
		uuid.NewString(), time.Now(),
		mustMarshal(t, consumers.DraftPublishedPayload{
			DraftID: postID, OwnerID: authorID,
			PublishedAt: time.Now().UTC().Format(time.RFC3339),
		}),
	)

	hybridReader := feed.NewHybridFeedReader(
		feed.HybridConfig{
			CelebrityThreshold: 1000,
			DefaultPageSize:    20,
			MaxPageSize:        50,
			PerCelebrityLimit:  5,
		},
		env.Redis, env.DB, env.Log,
	)

	page, err := hybridReader.GetFeed(context.Background(), feed.GetFeedInput{
		UserID: reader, Limit: 20,
	})
	if err != nil {
		t.Fatalf("GetFeed: %v", err)
	}

	found := false
	for _, p := range page.Posts {
		if p.ID == postID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected post in feed")
	}
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}