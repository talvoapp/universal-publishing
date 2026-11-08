// Package cache provides caching primitives for content-service.
//
// The primary cache is the ENTITLEMENT cache, which stores the resolved
// access decision for a (user, item[, chapter]) tuple. This avoids hitting
// PostgreSQL on every `/read` request.
//
// KEY FORMAT:
//   content:ent:{userId}:{itemId}              (whole-item)
//   content:ent:{userId}:{itemId}:{chapterId}  (specific chapter)
//
// VALUE FORMAT (JSON):
//   {"granted": true, "type": "purchase"}
//   {"granted": false, "type": "none"}
//
// Storing the TYPE (not just granted/denied) is important because:
//   - The response includes `entitlementType` for the frontend.
//   - Analytics rely on the type (purchase vs subscription vs owner).
//   - Without type, cache hits return the wrong type (bug).
//
// TTL:
//   Configured via ENTITLEMENT_CACHE_TTL (default 5 min).
//   Short TTL is intentional: purchase/refund events invalidate cache
//   explicitly, so a stale value is corrected within 5 min even if
//   invalidation is missed.
//
// SECURITY:
//   Cache keys are per-user (never shared). A compromised cache cannot
//   leak another user's entitlements.
package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/db"
)

// EntitlementType mirrors middleware.EntitlementType. Duplicated here
// to avoid a circular import (middleware imports cache).
type EntitlementType string

const (
	EntitlementNone         EntitlementType = "none"
	EntitlementPurchase     EntitlementType = "purchase"
	EntitlementSubscription EntitlementType = "subscription"
	EntitlementOwner        EntitlementType = "owner"
	EntitlementAdmin        EntitlementType = "admin"
)

// Decision is the cached value.
type Decision struct {
	Granted bool            `json:"granted"`
	Type    EntitlementType `json:"type"`
}

// EntitlementCache caches entitlement decisions in Redis.
type EntitlementCache struct {
	redis *redis.Client
	ttl   time.Duration
	log   *zap.Logger
}

// NewEntitlementCache creates a new cache with the given TTL.
func NewEntitlementCache(rdb *redis.Client, ttl time.Duration, log *zap.Logger) *EntitlementCache {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &EntitlementCache{
		redis: rdb,
		ttl:   ttl,
		log:   log,
	}
}

// Get retrieves the cached decision for a (user, item, chapter) tuple.
//
// Returns:
//   - (decision, true, nil)  → cache hit
//   - (nil, false, nil)      → cache miss
//   - (nil, false, err)      → Redis error (caller should fall back to DB)
func (c *EntitlementCache) Get(
	ctx context.Context,
	userID, itemID, chapterID string,
) (*Decision, bool, error) {
	key := c.buildKey(userID, itemID, chapterID)

	val, err := c.redis.Get(ctx, key).Result()
	if err == redis.Nil {
		return nil, false, nil
	}
	if err != nil {
		// Redis error — return error so caller can decide (fail open → DB).
		c.log.Warn("entitlement_cache_get_failed",
			zap.Error(err),
			zap.String("user_id", userID),
			zap.String("item_id", itemID),
		)
		return nil, false, err
	}

	var decision Decision
	if err := json.Unmarshal([]byte(val), &decision); err != nil {
		// Corrupted entry — treat as miss.
		c.log.Warn("entitlement_cache_corrupt",
			zap.Error(err),
			zap.String("key", key),
			zap.String("raw", val),
		)
		return nil, false, nil
	}

	return &decision, true, nil
}

// Set caches a decision. Best-effort — never blocks the request on failure.
func (c *EntitlementCache) Set(
	ctx context.Context,
	userID, itemID, chapterID string,
	decision Decision,
) {
	key := c.buildKey(userID, itemID, chapterID)

	data, err := json.Marshal(decision)
	if err != nil {
		c.log.Warn("entitlement_cache_marshal_failed", zap.Error(err))
		return
	}

	if err := c.redis.Set(ctx, key, data, c.ttl).Err(); err != nil {
		c.log.Warn("entitlement_cache_set_failed",
			zap.Error(err),
			zap.String("key", key),
		)
	}
}

// InvalidateUser removes ALL cached entitlements for a user.
//
// Called when:
//   - A purchase is made (from marketplace webhook → not wired in v1)
//   - A refund is issued
//   - A subscription is cancelled
//
// Uses SCAN (not KEYS) — safe for production Redis.
func (c *EntitlementCache) InvalidateUser(ctx context.Context, userID string) (int, error) {
	pattern := db.Key("ent", userID, "*")
	iter := c.redis.Scan(ctx, 0, pattern, 100).Iterator()
	count := 0

	for iter.Next(ctx) {
		key := iter.Val()
		if err := c.redis.Del(ctx, key).Err(); err != nil {
			c.log.Warn("entitlement_cache_del_failed",
				zap.Error(err),
				zap.String("key", key),
			)
		} else {
			count++
		}
	}
	if err := iter.Err(); err != nil {
		c.log.Error("entitlement_cache_scan_failed", zap.Error(err))
		return count, err
	}

	c.log.Info("entitlement_cache_invalidated",
		zap.String("user_id", userID),
		zap.Int("keys_deleted", count),
	)
	return count, nil
}

// InvalidateItem removes cached entitlements for a specific item across
// all users. Expensive at scale — v1 logs a warning and relies on TTL.
func (c *EntitlementCache) InvalidateItem(ctx context.Context, itemID string) {
	c.log.Warn("invalidate_item_cache_not_implemented",
		zap.String("item_id", itemID),
		zap.String("hint", "rely on TTL expiry"),
	)
}

// Stats returns basic cache statistics (used by /metrics).
func (c *EntitlementCache) Stats(ctx context.Context) (map[string]any, error) {
	pattern := db.Key("ent", "*")
	var cursor uint64
	count := 0

	for {
		keys, next, err := c.redis.Scan(ctx, cursor, pattern, 1000).Result()
		if err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		count += len(keys)
		cursor = next
		if cursor == 0 {
			break
		}
	}

	return map[string]any{
		"keys_total":  count,
		"ttl_seconds": int(c.ttl.Seconds()),
	}, nil
}

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

func (c *EntitlementCache) buildKey(userID, itemID, chapterID string) string {
	if chapterID != "" {
		return db.Key("ent", userID, itemID, chapterID)
	}
	return db.Key("ent", userID, itemID)
}