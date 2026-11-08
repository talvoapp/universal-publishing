package services

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/db"
)

// EntitlementService provides helpers to INVALIDATE entitlement cache.
//
// This is used by the webhook handler (if we had one) or by an admin
// tool to force a cache refresh when a user's entitlements change
// (e.g., after a refund).
//
// The actual entitlement CHECKING is done in the middleware. This
// service only handles cache invalidation.
type EntitlementService struct {
	db    *pgxpool.Pool
	redis *redis.Client
	log   *zap.Logger
}

// NewEntitlementService creates an EntitlementService.
func NewEntitlementService(pool *pgxpool.Pool, rdb *redis.Client, log *zap.Logger) *EntitlementService {
	return &EntitlementService{db: pool, redis: rdb, log: log}
}

// InvalidateUserCache removes ALL entitlement cache entries for a user.
// Called when:
//   - A purchase is made (from marketplace webhook → not implemented in v1)
//   - A refund is issued
//   - A subscription is cancelled
//
// v1 approach: iterate all keys with pattern `content:ent:{userId}:*`.
// This is O(N) but N is small per user. Acceptable for v1; v2 should
// use a user-versioning scheme (e.g., `content:entver:{userId}` cached
// alongside entitlements, bumped on any change).
func (s *EntitlementService) InvalidateUserCache(ctx context.Context, userID string) error {
	pattern := db.Key("ent", userID, "*")
	iter := s.redis.Scan(ctx, 0, pattern, 100).Iterator()
	count := 0

	for iter.Next(ctx) {
		key := iter.Val()
		if err := s.redis.Del(ctx, key).Err(); err != nil {
			s.log.Warn("entitlement_cache_del_failed",
				zap.Error(err),
				zap.String("key", key),
			)
		}
		count++
	}
	if err := iter.Err(); err != nil {
		s.log.Error("entitlement_cache_scan_failed", zap.Error(err))
		return err
	}

	s.log.Info("entitlement_cache_invalidated",
		zap.String("user_id", userID),
		zap.Int("keys_deleted", count),
	)
	return nil
}

// InvalidateItemCache removes entitlement cache for a specific item,
// across ALL users. Used when an item's publishing status changes.
//
// WARNING: this is expensive at scale. In v2, use a global version bump
// on the item's cache key.
func (s *EntitlementService) InvalidateItemCache(ctx context.Context, itemID string) error {
	// Cannot efficiently do this without knowing all users. In v1, we
	// rely on TTL (5min) to expire stale entries. Log the intent.
	s.log.Warn("invalidate_item_cache_not_implemented",
		zap.String("item_id", itemID),
		zap.String("hint", "rely on TTL expiry"),
	)
	return nil
}