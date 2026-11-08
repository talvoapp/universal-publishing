package db

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// KeyPrefix is prepended to all keys (configurable at startup).
var KeyPrefix = "wallet:"

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

// RedisHealthCheck returns true if Redis is reachable.
func RedisHealthCheck(ctx context.Context, client *redis.Client) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return client.Ping(ctx).Err() == nil
}

// SetNX is a helper for dedup/idempotency.
func SetNX(ctx context.Context, client *redis.Client, key string, value any, ttl time.Duration) (bool, error) {
	return client.SetNX(ctx, key, value, ttl).Result()
}