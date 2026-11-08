//go:build integration

package tests

import (
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ============================================================
// FEED INTEGRATION TESTS
// ============================================================

func TestFollow_IncrementsCounters(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	follower := uuid.NewString()
	followee := uuid.NewString()

	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $2, 'active')
	`, follower, followee)
	if err != nil {
		t.Fatalf("insert follow: %v", err)
	}

	var count int
	_ = env.DB.QueryRow(env.Ctx,
		`SELECT COUNT(*) FROM follows WHERE follower_id = $1 AND followee_id = $2`,
		follower, followee).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 follow, got %d", count)
	}
}

func TestFollow_SelfFollowPrevented(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	userID := uuid.NewString()

	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO follows (follower_id, followee_id, status) VALUES ($1, $1, 'active')
	`, userID)
	if err == nil {
		t.Errorf("expected CHECK constraint to reject self-follow")
	}
}

func TestTimeline_RedisSortedSet(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	userID := uuid.NewString()
	key := "feed:timeline:" + userID

	env.Redis.ZAdd(env.Ctx, key,
		redis.Z{Score: 1700000100, Member: "post-a"},
		redis.Z{Score: 1700000200, Member: "post-b"},
		redis.Z{Score: 1700000300, Member: "post-c"},
	)

	results, err := env.Redis.ZRevRangeWithScores(env.Ctx, key, 0, 1).Result()
	if err != nil {
		t.Fatalf("zrevrange: %v", err)
	}

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Member.(string) != "post-c" {
		t.Errorf("expected post-c first, got %v", results[0].Member)
	}
	if results[1].Member.(string) != "post-b" {
		t.Errorf("expected post-b second, got %v", results[1].Member)
	}
}

func TestAuthorIndex_SeparateFromTimeline(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	authorKey := "feed:author:" + authorID
	timelineKey := "feed:timeline:" + authorID

	env.Redis.ZAdd(env.Ctx, authorKey, redis.Z{Score: 1700000100, Member: "post-a"})
	env.Redis.ZAdd(env.Ctx, timelineKey, redis.Z{Score: 1700000100, Member: "post-a"})

	aCard := env.Redis.ZCard(env.Ctx, authorKey).Val()
	tCard := env.Redis.ZCard(env.Ctx, timelineKey).Val()

	if aCard != 1 {
		t.Errorf("expected author index cardinality 1, got %d", aCard)
	}
	if tCard != 1 {
		t.Errorf("expected timeline cardinality 1, got %d", tCard)
	}
}