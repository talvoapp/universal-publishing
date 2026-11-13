package db

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// KeyPrefix is prepended to all keys.
//
// Default "feed:" — overwritten at startup by InitKeyPrefix(cfg.RedisKeyPrefix).
var KeyPrefix = "feed:"

// InitKeyPrefix sets the global key prefix from config.
//
// Called once from cmd/main.go after loading config. Empty string is
// ignored (keeps the default). This lets operators override the
// prefix via REDIS_KEY_PREFIX without changing code.
func InitKeyPrefix(prefix string) {
	if prefix != "" {
		KeyPrefix = prefix
	}
}

// Key builds a namespaced Redis key.
func Key(parts ...string) string {
	out := KeyPrefix
	for i, p := range parts {
		if i > 0 {
			out += ":"
		}
		out += p
	}
	return out
}

// ============================================================
// TIMELINE KEYS
// ============================================================
//
// Two kinds of timelines:
//   - USER timeline:   feed:timeline:{userId}       (personal feed)
//   - AUTHOR timeline: feed:author:{authorId}       (posts by an author — used for pull)
//
// Both are Redis Sorted Sets where:
//   member = postID (string)
//   score  = publish time (unix seconds)
//
// Sorted Set gives us O(log N) insert and O(log N + M) range reads,
// where M is the requested page size.

// TimelineKey returns the Redis key for a user's personal feed.
func TimelineKey(userID string) string {
	return Key("timeline", userID)
}

// AuthorPostsKey returns the Redis key for an author's posts index.
// Used to pull posts from celebrity authors at read time.
func AuthorPostsKey(authorID string) string {
	return Key("author", authorID)
}

// FollowerCountKey returns the Redis key for a cached follower count.
func FollowerCountKey(authorID string) string {
	return Key("followers_count", authorID)
}

// ============================================================
// HEALTH
// ============================================================
func RedisHealthCheck(ctx context.Context, client *redis.Client) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return client.Ping(ctx).Err() == nil
}