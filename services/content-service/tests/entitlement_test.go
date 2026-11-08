//go:build integration

package tests

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// ============================================================
// ENTITLEMENT RESOLUTION TESTS
// ============================================================
// These test the SQL/query layer that backs the entitlement middleware.
// The middleware itself is tested end-to-end in content_test.go.

func TestEntitlement_PurchaseGrants(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	buyerID := uuid.NewString()

	// Seed item
	var itemID string
	err := env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Test', 'USD', 1299, TRUE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)
	if err != nil {
		t.Fatalf("seed item: %v", err)
	}

	// Seed succeeded order
	_, err = env.DB.Exec(env.Ctx, `
		INSERT INTO orders (buyer_id, item_id, author_id, currency,
		                    subtotal, tax_amount, platform_fee, author_earnings, total,
		                    status)
		VALUES ($1, $2, $3, 'USD', 12.99, 1.04, 1.95, 11.04, 14.03, 'succeeded')
	`, buyerID, itemID, authorID)
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}

	// Verify purchase check
	var found bool
	_ = env.DB.QueryRow(env.Ctx, `
		SELECT EXISTS(
			SELECT 1 FROM orders
			WHERE buyer_id = $1 AND item_id = $2 AND status = 'succeeded'
		)
	`, buyerID, itemID).Scan(&found)

	if !found {
		t.Errorf("expected purchase found")
	}
}

func TestEntitlement_PendingOrderDoesNotGrant(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	buyerID := uuid.NewString()

	var itemID string
	_ = env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Test', 'USD', 1299, TRUE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)

	// Pending order (not yet paid)
	_, _ = env.DB.Exec(env.Ctx, `
		INSERT INTO orders (buyer_id, item_id, author_id, currency,
		                    subtotal, tax_amount, platform_fee, author_earnings, total,
		                    status)
		VALUES ($1, $2, $3, 'USD', 12.99, 1.04, 1.95, 11.04, 14.03, 'pending')
	`, buyerID, itemID, authorID)

	var found bool
	_ = env.DB.QueryRow(env.Ctx, `
		SELECT EXISTS(
			SELECT 1 FROM orders
			WHERE buyer_id = $1 AND item_id = $2 AND status = 'succeeded'
		)
	`, buyerID, itemID).Scan(&found)

	if found {
		t.Errorf("pending order must NOT grant entitlement")
	}
}

func TestEntitlement_ChapterPurchase(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	buyerID := uuid.NewString()

	var itemID string
	_ = env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_chapter', 'Test', 'USD', 0, TRUE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)

	var chapterID string
	_ = env.DB.QueryRow(env.Ctx, `
		INSERT INTO chapters (item_id, index, title, price_cents, word_count, content_published)
		VALUES ($1, 1, 'Chapter 1', 199, 1000, TRUE)
		RETURNING id
	`, itemID).Scan(&chapterID)

	// Purchase specific chapter
	_, _ = env.DB.Exec(env.Ctx, `
		INSERT INTO orders (buyer_id, item_id, author_id, chapter_ids, currency,
		                    subtotal, tax_amount, platform_fee, author_earnings, total,
		                    status)
		VALUES ($1, $2, $3, ARRAY[$4]::uuid[], 'USD', 1.99, 0, 0.30, 1.69, 1.99, 'succeeded')
	`, buyerID, itemID, authorID, chapterID)

	// Verify chapter-level grant
	var found bool
	_ = env.DB.QueryRow(env.Ctx, `
		SELECT EXISTS(
			SELECT 1 FROM orders
			WHERE buyer_id = $1 AND status = 'succeeded'
			  AND item_id = $2 AND $3 = ANY(chapter_ids::text[])
		)
	`, buyerID, itemID, chapterID).Scan(&found)

	if !found {
		t.Errorf("expected chapter purchase found")
	}
}

func TestEntitlement_OwnerAlwaysGrants(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	var itemID string
	_ = env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Test', 'USD', 1299, TRUE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)

	// Author queries own item — ownership check
	var fetchedAuthorID string
	_ = env.DB.QueryRow(env.Ctx, `SELECT author_id FROM items WHERE id = $1`, itemID).Scan(&fetchedAuthorID)

	if fetchedAuthorID != authorID {
		t.Errorf("owner check failed: expected %s, got %s", authorID, fetchedAuthorID)
	}
}