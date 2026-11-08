// Package middleware — entitlement checking.
//
// THE CRITICAL SECURITY LAYER:
//
// Before serving ANY paid content, we must verify the user has purchased
// access. This middleware:
//   1. Extracts item_id (and optional chapter_id) from the URL params.
//   2. Checks Redis cache (`content:ent:{userId}:{itemId}[:{chapterId}]`).
//   3. On cache miss, queries PostgreSQL `purchases` + `subscriptions`.
//   4. Populates the cache with the result.
//   5. Stores the EntitlementStatus in the request context.
//   6. If not entitled → 403 with a purchase prompt payload.
//
// SECURITY NOTES:
//   - Cache is per-user (not global). Never leak another user's entitlement.
//   - Admin role bypasses the check (for moderation/support).
//   - Author of the item always has access (owner).
//   - Free previews do NOT go through this middleware — they use the
//     `/preview` route which returns a truncated excerpt.
package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/db"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// EntitlementType is the kind of access a user has.
type EntitlementType string

const (
	EntitlementNone         EntitlementType = "none"
	EntitlementPurchase     EntitlementType = "purchase"
	EntitlementSubscription EntitlementType = "subscription"
	EntitlementOwner        EntitlementType = "owner"
	EntitlementAdmin        EntitlementType = "admin"
)

// EntitlementStatus is the resolved access decision stored in context.
type EntitlementStatus struct {
	UserID     string
	ItemID     string
	ChapterID  string // empty if whole-item
	Type       EntitlementType
	Granted    bool
	CachedAt   time.Time
}

// entitlementContextKey is the context key for EntitlementStatus.
type entitlementContextKey struct{}

// EntitlementFromContext returns the entitlement status, or nil.
func EntitlementFromContext(ctx context.Context) *EntitlementStatus {
	if e, ok := ctx.Value(entitlementContextKey{}).(*EntitlementStatus); ok {
		return e
	}
	return nil
}

// EntitlementMiddleware returns middleware that enforces entitlements.
//
// It reads `itemID` (and optionally `chapterID`) from chi URL params.
// Callers MUST mount this AFTER RequireAuth (so UserFromContext is populated).
//
// Behaviour:
//   - Admin → granted (bypass)
//   - Author of the item → granted (via ownership check)
//   - Purchased chapter/item → granted
//   - Active subscription → granted (if target matches)
//   - Otherwise → 403 with purchase prompt
func EntitlementMiddleware(
	pool *pgxpool.Pool,
	rdb *redis.Client,
	ttl time.Duration,
	log *zap.Logger,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := UserFromContext(r.Context())
			if user == nil {
				writeAuthError(w, r, "Not authenticated", "UNAUTHORIZED")
				return
			}

			itemID := chi.URLParam(r, "itemID")
			chapterID := chi.URLParam(r, "chapterID")

			if itemID == "" {
				// No item ID in URL — not a content endpoint. Pass through.
				next.ServeHTTP(w, r)
				return
			}

			// Admin bypass
			if user.Role == RoleAdmin {
				status := &EntitlementStatus{
					UserID:   user.ID,
					ItemID:   itemID,
					ChapterID: chapterID,
					Type:     EntitlementAdmin,
					Granted:  true,
					CachedAt: time.Now(),
				}
				ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Try cache first
			cacheKey := entitlementCacheKey(user.ID, itemID, chapterID)
			status, err := getCachedEntitlement(r.Context(), rdb, cacheKey, user.ID, itemID, chapterID)
			if err == nil && status != nil {
				if !status.Granted {
					writeEntitlementError(w, r, rdb, pool, user.ID, itemID, chapterID, log)
					return
				}
				ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Cache miss — query DB
			status, err = resolveEntitlement(r.Context(), pool, user, itemID, chapterID)
			if err != nil {
				log.Error("entitlement_resolution_failed",
					zap.Error(err),
					zap.String("user_id", user.ID),
					zap.String("item_id", itemID),
				)
				writeAuthError(w, r, "Failed to check entitlement", "ENTITLEMENT_CHECK_FAILED")
				return
			}

			// Populate cache
			setCachedEntitlement(r.Context(), rdb, cacheKey, status, ttl)

			if !status.Granted {
				writeEntitlementError(w, r, rdb, pool, user.ID, itemID, chapterID, log)
				return
			}

			ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ------------------------------------------------------------
// Resolution (cache miss)
// ------------------------------------------------------------
func resolveEntitlement(
	ctx context.Context,
	pool *pgxpool.Pool,
	user *UserContext,
	itemID, chapterID string,
) (*EntitlementStatus, error) {
	// 1. Owner check — the author of the item has access
	var authorID string
	err := pool.QueryRow(ctx, `SELECT author_id FROM items WHERE id = $1`, itemID).Scan(&authorID)
	if err == nil && authorID == user.ID {
		return &EntitlementStatus{
			UserID:    user.ID,
			ItemID:    itemID,
			ChapterID: chapterID,
			Type:      EntitlementOwner,
			Granted:   true,
			CachedAt:  time.Now(),
		}, nil
	}

	// 2. Purchase check — for either whole item or specific chapter
	var purchaseFound bool
	if chapterID != "" {
		err = pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM orders
				WHERE buyer_id = $1 AND status = 'succeeded'
				  AND (
				    (item_id = $2 AND cardinality(chapter_ids) = 0)
				    OR
				    (item_id = $2 AND $3 = ANY(chapter_ids::text[]))
				  )
			)
		`, user.ID, itemID, chapterID).Scan(&purchaseFound)
	} else {
		err = pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM orders
				WHERE buyer_id = $1 AND item_id = $2 AND status = 'succeeded'
			)
		`, user.ID, itemID).Scan(&purchaseFound)
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("purchase check: %w", err)
	}
	if purchaseFound {
		return &EntitlementStatus{
			UserID:    user.ID,
			ItemID:    itemID,
			ChapterID: chapterID,
			Type:      EntitlementPurchase,
			Granted:   true,
			CachedAt:  time.Now(),
		}, nil
	}

	// 3. Subscription check — for news channels / authors
	var subFound bool
	err = pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM subscriptions
			WHERE buyer_id = $1 AND status = 'active'
			  AND (
			    target_type = 'author'
			    OR target_type = 'news_channel'
			  )
		)
	`, user.ID).Scan(&subFound)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("subscription check: %w", err)
	}
	if subFound {
		return &EntitlementStatus{
			UserID:    user.ID,
			ItemID:    itemID,
			ChapterID: chapterID,
			Type:      EntitlementSubscription,
			Granted:   true,
			CachedAt:  time.Now(),
		}, nil
	}

	// 4. No entitlement
	return &EntitlementStatus{
		UserID:    user.ID,
		ItemID:    itemID,
		ChapterID: chapterID,
		Type:      EntitlementNone,
		Granted:   false,
		CachedAt:  time.Now(),
	}, nil
}

// ------------------------------------------------------------
// Cache helpers
// ------------------------------------------------------------
func entitlementCacheKey(userID, itemID, chapterID string) string {
	if chapterID != "" {
		return db.Key("ent", userID, itemID, chapterID)
	}
	return db.Key("ent", userID, itemID)
}

func getCachedEntitlement(
	ctx context.Context,
	rdb *redis.Client,
	cacheKey, userID, itemID, chapterID string,
) (*EntitlementStatus, error) {
	val, err := rdb.Get(ctx, cacheKey).Result()
	if err != nil {
		return nil, err
	}
	// Cache stores "1" (granted) or "0" (denied)
	// We don't cache the entitlement type in v1 — only granted/denied.
	// Type is only used for logging/analytics.
	status := &EntitlementStatus{
		UserID:    userID,
		ItemID:    itemID,
		ChapterID: chapterID,
		Type:      EntitlementPurchase, // inferred; not critical
		Granted:   val == "1",
		CachedAt:  time.Now(),
	}
	if !status.Granted {
		status.Type = EntitlementNone
	}
	return status, nil
}

func setCachedEntitlement(
	ctx context.Context,
	rdb *redis.Client,
	cacheKey string,
	status *EntitlementStatus,
	ttl time.Duration,
) {
	val := "0"
	if status.Granted {
		val = "1"
	}
	_ = rdb.Set(ctx, cacheKey, val, ttl).Err()
}

// ------------------------------------------------------------
// Error response
// ------------------------------------------------------------
func writeEntitlementError(
	w http.ResponseWriter,
	r *http.Request,
	rdb *redis.Client,
	pool *pgxpool.Pool,
	userID, itemID, chapterID string,
	log *zap.Logger,
) {
	// Fetch price for the error payload (for the frontend purchase prompt)
	priceCents := int64(0)
	currency := "USD"
	if chapterID != "" {
		_ = pool.QueryRow(r.Context(),
			`SELECT price_cents, currency FROM chapters WHERE id = $1`, chapterID,
		).Scan(&priceCents, &currency)
	} else {
		_ = pool.QueryRow(r.Context(),
			`SELECT price_cents, currency FROM items WHERE id = $1`, itemID,
		).Scan(&priceCents, &currency)
	}

	appErr := utils.EntitlementRequired(itemID, chapterID, priceCents, currency)
	reqID := RequestIDFromContext(r.Context())
	appErr.Write(w, reqID)

	log.Info("entitlement_denied",
		zap.String("user_id", userID),
		zap.String("item_id", itemID),
		zap.String("chapter_id", chapterID),
	)
}