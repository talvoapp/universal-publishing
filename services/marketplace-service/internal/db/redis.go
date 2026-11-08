package db

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// KeyPrefix is prepended to all keys to namespace them per service.
// Set from config at startup. Defaults to "market:".
var KeyPrefix = "market:"

// Key builds a namespaced Redis key.
//
//	Key("idem", "user-123", "order-456") → "market:idem:user-123:order-456"
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

// SetNX is a helper for idempotency locks:
//
//	ok, err := db.SetNX(ctx, rdb, key, value, ttl)
//	if !ok { /* key exists */ }
func SetNX(ctx context.Context, client *redis.Client, key string, value any, ttl time.Duration) (bool, error) {
	return client.SetNX(ctx, key, value, ttl).Result()
}