// Package tests contains integration tests for the marketplace service.
//
// Integration tests differ from unit tests (in `internal/`) by requiring:
//   - A real PostgreSQL database (via TEST_DATABASE_URL)
//   - A real Redis (via TEST_REDIS_URL)
//   - Stripe mocked at the HTTP level (via stripe-mock or a local stub)
//
// Run with:
//   go test -tags=integration ./tests/...
//
// Skipped by default:
//   go test ./...    // unit tests only
//
//go:build integration

package tests

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// TestEnv holds shared integration-test dependencies.
type TestEnv struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *zap.Logger
	Ctx   context.Context
}

// NewTestEnv creates a TestEnv connected to the test database + redis.
// Fails the test immediately if env vars are missing or connections fail.
func NewTestEnv(t *testing.T) *TestEnv {
	t.Helper()

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatalf("TEST_DATABASE_URL is required for integration tests")
	}
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Fatalf("TEST_REDIS_URL is required for integration tests")
	}

	ctx := context.Background()

	// --- Postgres ---
	poolCfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("parse TEST_DATABASE_URL: %v", err)
	}
	poolCfg.MinConns = 1
	poolCfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Fatalf("connect to test db: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping test db: %v", err)
	}

	// --- Redis ---
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse TEST_REDIS_URL: %v", err)
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping test redis: %v", err)
	}

	// --- Logger ---
	log, _ := zap.NewDevelopment()

	return &TestEnv{
		DB:    pool,
		Redis: rdb,
		Log:   log,
		Ctx:   ctx,
	}
}

// Cleanup releases connections.
func (e *TestEnv) Cleanup(t *testing.T) {
	t.Helper()
	if e.DB != nil {
		e.DB.Close()
	}
	if e.Redis != nil {
		_ = e.Redis.Close()
	}
}

// Truncate removes all rows from marketplace tables.
// Called between tests to guarantee isolation.
func (e *TestEnv) Truncate(t *testing.T) {
	t.Helper()
	_, err := e.DB.Exec(e.Ctx, `
		TRUNCATE TABLE
			outbox,
			subscriptions,
			orders,
			chapters,
			items
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate tables: %v", err)
	}

	// Flush only our namespace in Redis
	keys, err := e.Redis.Keys(e.Ctx, "market:*").Result()
	if err != nil {
		t.Fatalf("scan redis keys: %v", err)
	}
	if len(keys) > 0 {
		if err := e.Redis.Del(e.Ctx, keys...).Err(); err != nil {
			t.Fatalf("delete redis keys: %v", err)
		}
	}
}

// SeedItem inserts a published item + returns its ID.
func (e *TestEnv) SeedItem(t *testing.T, authorID, draftID string, priceCents int64) string {
	t.Helper()

	var itemID string
	err := e.DB.QueryRow(e.Ctx, `
		INSERT INTO items (
			draft_id, author_id, type, pricing_model, title, description,
			currency, price_cents, is_published, word_count, read_minutes
		) VALUES ($1, $2, 'book', 'pay_per_book', 'Test Book', 'A test description',
		          'USD', $3, TRUE, 5000, 25)
		RETURNING id
	`, draftID, authorID, priceCents).Scan(&itemID)
	if err != nil {
		t.Fatalf("seed item: %v", err)
	}
	return itemID
}

// SeedChapter inserts a chapter for an item.
func (e *TestEnv) SeedChapter(t *testing.T, itemID string, index int, priceCents int64) string {
	t.Helper()

	var chapterID string
	err := e.DB.QueryRow(e.Ctx, `
		INSERT INTO chapters (item_id, index, title, price_cents, word_count, content_published)
		VALUES ($1, $2, $3, $4, 1000, TRUE)
		RETURNING id
	`, itemID, index, fmt.Sprintf("Chapter %d", index), priceCents).Scan(&chapterID)
	if err != nil {
		t.Fatalf("seed chapter: %v", err)
	}
	return chapterID
}

// SeedOrder inserts an order row.
func (e *TestEnv) SeedOrder(t *testing.T, buyerID, itemID, authorID string, status string) string {
	t.Helper()

	var orderID string
	err := e.DB.QueryRow(e.Ctx, `
		INSERT INTO orders (
			buyer_id, item_id, author_id, currency, subtotal, tax_amount,
			platform_fee, author_earnings, total, status,
			stripe_payment_intent_id
		) VALUES ($1, $2, $3, 'USD', 12.99, 1.04, 1.95, 11.04, 14.03, $4, 'pi_test')
		RETURNING id
	`, buyerID, itemID, authorID, status).Scan(&orderID)
	if err != nil {
		t.Fatalf("seed order: %v", err)
	}
	return orderID
}

// CountOutbox returns the number of outbox rows with the given event type.
func (e *TestEnv) CountOutbox(t *testing.T, eventType string) int {
	t.Helper()

	var n int
	err := e.DB.QueryRow(e.Ctx,
		`SELECT count(*) FROM outbox WHERE event_type = $1`, eventType,
	).Scan(&n)
	if err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	return n
}