//go:build integration

package tests

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
)

// TestEnv holds shared integration-test dependencies.
type TestEnv struct {
	DB     *pgxpool.Pool
	Log    *zap.Logger
	Ctx    context.Context
	Ledger *ledger.Service
}

// NewTestEnv creates a TestEnv.
func NewTestEnv(t *testing.T) *TestEnv {
	t.Helper()

	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatalf("TEST_DATABASE_URL is required for integration tests")
	}

	ctx := context.Background()

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

	log := zap.NewNop()

	return &TestEnv{
		DB:     pool,
		Log:    log,
		Ctx:    ctx,
		Ledger: ledger.NewService(pool, log),
	}
}

// Cleanup releases resources.
func (e *TestEnv) Cleanup(t *testing.T) {
	if e.DB != nil {
		e.DB.Close()
	}
}

// Truncate removes all rows from wallet tables.
func (e *TestEnv) Truncate(t *testing.T) {
	t.Helper()
	_, err := e.DB.Exec(e.Ctx, `
		TRUNCATE TABLE
			payouts,
			processed_events,
			ledger_entries,
			ledger_transactions,
			author_connect_accounts
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate: %v", err)
	}
}

// SeedConnect inserts an active Connect account for an author.
func (e *TestEnv) SeedConnect(t *testing.T, authorID string) {
	t.Helper()
	_, err := e.DB.Exec(e.Ctx, `
		INSERT INTO author_connect_accounts (
			author_id, stripe_account_id, status,
			charges_enabled, payouts_enabled, details_submitted
		) VALUES ($1, $2, 'active', TRUE, TRUE, TRUE)
	`, authorID, "acct_test_"+authorID[:8])
	if err != nil {
		t.Fatalf("seed connect: %v", err)
	}
}