//go:build integration

package tests

import (
	"context"
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

// NewTestEnv creates a TestEnv.
func NewTestEnv(t *testing.T) *TestEnv {
	t.Helper()

	dbURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if dbURL == "" || redisURL == "" {
		t.Fatalf("TEST_DATABASE_URL and TEST_REDIS_URL are required")
	}

	ctx := context.Background()

	// Postgres
	poolCfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		t.Fatalf("parse db url: %v", err)
	}
	poolCfg.MinConns = 1
	poolCfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	// Redis
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url: %v", err)
	}
	rdb := redis.NewClient(redisOpts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping redis: %v", err)
	}

	return &TestEnv{
		DB:    pool,
		Redis: rdb,
		Log:   zap.NewNop(),
		Ctx:   ctx,
	}
}

// Cleanup releases resources.
func (e *TestEnv) Cleanup(t *testing.T) {
	t.Helper()
	if e.DB != nil {
		e.DB.Close()
	}
	if e.Redis != nil {
		_ = e.Redis.Close()
	}
}

// Truncate clears all test data.
func (e *TestEnv) Truncate(t *testing.T) {
	t.Helper()

	// Postgres
	_, err := e.DB.Exec(e.Ctx, `
		TRUNCATE TABLE
			posts_metadata,
			users_follow_counts,
			follows
		RESTART IDENTITY CASCADE
	`)
	if err != nil {
		t.Fatalf("truncate pg: %v", err)
	}

	// Redis — flush our prefix
	keys, err := e.Redis.Keys(e.Ctx, "feed:*").Result()
	if err == nil && len(keys) > 0 {
		_ = e.Redis.Del(e.Ctx, keys...).Err()
	}
}