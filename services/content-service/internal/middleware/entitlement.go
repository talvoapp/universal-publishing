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
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/cache"
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
	UserID    string
	ItemID    string
	ChapterID string
	Type      EntitlementType
	Granted   bool
	CachedAt  time.Time
}

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
// Uses `cache.EntitlementCache` for the Redis cache layer.
//
// Flow:
//   1. Admin bypass (immediate grant, no DB/cache hit).
//   2. Cache lookup → returns full Decision (granted + type).
//   3. On cache miss → resolve from DB (3 queries: owner, purchase, subscription).
//   4. Populate cache with the resolved Decision (including type).
//   5. Populate request context with EntitlementStatus.
func EntitlementMiddleware(
	pool *pgxpool.Pool,
	cacheSvc *cache.EntitlementCache,
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
				next.ServeHTTP(w, r)
				return
			}

			// ----- 1. Admin bypass -----
			if user.Role == RoleAdmin {
				status := &EntitlementStatus{
					UserID:    user.ID,
					ItemID:    itemID,
					ChapterID: chapterID,
					Type:      EntitlementAdmin,
					Granted:   true,
					CachedAt:  time.Now(),
				}
				ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// ----- 2. Cache lookup (returns Decision with type) -----
			decision, hit, cacheErr := cacheSvc.Get(r.Context(), user.ID, itemID, chapterID)
			if cacheErr == nil && hit && decision != nil {
				status := &EntitlementStatus{
					UserID:    user.ID,
					ItemID:    itemID,
					ChapterID: chapterID,
					Type:      EntitlementType(decision.Type), // type from cache — correct!
					Granted:   decision.Granted,
					CachedAt:  time.Now(),
				}
				if !decision.Granted {
					writeEntitlementError(w, r, pool, user.ID, itemID, chapterID, log)
					return
				}
				ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// ----- 3. Cache miss — resolve from DB -----
			status, err := resolveEntitlement(r.Context(), pool, user, itemID, chapterID)
			if err != nil {
				log.Error("entitlement_resolution_failed",
					zap.Error(err),
					zap.String("user_id", user.ID),
					zap.String("item_id", itemID),
				)
				writeAuthError(w, r, "Failed to check entitlement", "ENTITLEMENT_CHECK_FAILED")
				return
			}

			// ----- 4. Populate cache with the decision (including type) -----
			cacheSvc.Set(r.Context(), user.ID, itemID, chapterID, cache.Decision{
				Granted: status.Granted,
				Type:    cache.EntitlementType(status.Type),
			})

			// ----- 5. Deny or proceed -----
			if !status.Granted {
				writeEntitlementError(w, r, pool, user.ID, itemID, chapterID, log)
				return
			}

			ctx := context.WithValue(r.Context(), entitlementContextKey{}, status)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// resolveEntitlement computes the access decision from scratch.
//
// Order:
//  1. Owner (author of the item) → always granted
//  2. Purchase (succeeded order) → granted
//  3. Subscription (active) → granted
//  4. None → denied
func resolveEntitlement(
	ctx context.Context,
	pool *pgxpool.Pool,
	user *UserContext,
	itemID, chapterID string,
) (*EntitlementStatus, error) {
	// 1. Owner
	var authorID string
	err := pool.QueryRow(ctx, `SELECT author_id FROM items WHERE id = $1`, itemID).Scan(&authorID)
	if err == nil && authorID == user.ID {
		return &EntitlementStatus{
			UserID: user.ID, ItemID: itemID, ChapterID: chapterID,
			Type: EntitlementOwner, Granted: true, CachedAt: time.Now(),
		}, nil
	}

	// 2. Purchase
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
			UserID: user.ID, ItemID: itemID, ChapterID: chapterID,
			Type: EntitlementPurchase, Granted: true, CachedAt: time.Now(),
		}, nil
	}

	// 3. Subscription
	var subFound bool
	err = pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM subscriptions
			WHERE buyer_id = $1 AND status = 'active'
		)
	`, user.ID).Scan(&subFound)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("subscription check: %w", err)
	}
	if subFound {
		return &EntitlementStatus{
			UserID: user.ID, ItemID: itemID, ChapterID: chapterID,
			Type: EntitlementSubscription, Granted: true, CachedAt: time.Now(),
		}, nil
	}

	// 4. None
	return &EntitlementStatus{
		UserID: user.ID, ItemID: itemID, ChapterID: chapterID,
		Type: EntitlementNone, Granted: false, CachedAt: time.Now(),
	}, nil
}

// writeEntitlementError writes the 403 response with a purchase prompt.
func writeEntitlementError(
	w http.ResponseWriter,
	r *http.Request,
	pool *pgxpool.Pool,
	userID, itemID, chapterID string,
	log *zap.Logger,
) {
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