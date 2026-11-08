// Package main is the entry point for content-service.
//
// Startup order:
//  1. Load config (fails fast on invalid env)
//  2. Initialize logger
//  3. Connect to PostgreSQL (entitlements)
//  4. Connect to MongoDB (content)
//  5. Connect to Redis (cache)
//  6. Start HTTP server
//  7. Wait for SIGTERM/SIGINT → graceful shutdown
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/config"
	"github.com/talvoapp/universal-publishing/content-service/internal/server"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

func main() {
	// ----- 1. Config -----
	cfg := config.MustLoad()

	// ----- 2. Logger -----
	logger, err := utils.NewLogger(cfg.Env, cfg.LogLevel)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[FATAL] build logger: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = logger.Sync() }()

	logger.Info("starting",
		zap.String("env", cfg.Env),
		zap.String("version", cfg.ServiceVersion),
		zap.Int("port", cfg.Port),
	)

	// ----- 3. Root context -----
	ctx, cancel := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer cancel()

	// ----- 4. PostgreSQL (entitlements) -----
	db, err := newPostgresPool(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("postgres_init_failed", zap.Error(err))
	}
	logger.Info("postgres_connected")

	// ----- 5. MongoDB (content) -----
	mongoClient, err := newMongoClient(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("mongo_init_failed", zap.Error(err))
	}
	logger.Info("mongo_connected")

	// ----- 6. Redis (cache) -----
	rdb, err := newRedisClient(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("redis_init_failed", zap.Error(err))
	}
	logger.Info("redis_connected")

	// ----- 7. Server -----
	srv := server.New(server.Deps{
		Cfg:   cfg,
		Log:   logger,
		DB:    db,
		Mongo: mongoClient,
		Redis: rdb,
	})

	if err := srv.Start(ctx); err != nil {
		logger.Fatal("server_error", zap.Error(err))
	}
}

// newPostgresPool creates and verifies a pgx pool with retries.
func newPostgresPool(ctx context.Context, cfg *config.Config, log *zap.Logger) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse db url: %w", err)
	}
	poolCfg.MinConns = int32(cfg.DatabasePoolMin)
	poolCfg.MaxConns = int32(cfg.DatabasePoolMax)
	poolCfg.ConnConfig.RuntimeParams["application_name"] = cfg.ServiceName
	poolCfg.ConnConfig.RuntimeParams["statement_timeout"] = fmt.Sprintf("%d", cfg.DatabaseStatementTimeout.Milliseconds())

	delay := 500 * time.Millisecond
	var lastErr error
	for attempt := 1; attempt <= 10; attempt++ {
		pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
		if err != nil {
			lastErr = err
		} else if err := pool.Ping(ctx); err != nil {
			pool.Close()
			lastErr = err
		} else {
			return pool, nil
		}

		log.Warn("postgres_connect_retry",
			zap.Int("attempt", attempt),
			zap.Duration("retry_in", delay),
			zap.Error(lastErr),
		)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		delay = minDuration(delay*2, 10*time.Second)
	}
	return nil, fmt.Errorf("could not connect to postgres after 10 attempts: %w", lastErr)
}

// newMongoClient creates and verifies a Mongo client with retries.
func newMongoClient(ctx context.Context, cfg *config.Config, log *zap.Logger) (*mongo.Client, error) {
	opts := options.Client().
		ApplyURI(cfg.MongoURL).
		SetMaxPoolSize(uint64(cfg.MongoMaxPool)).
		SetServerSelectionTimeout(cfg.MongoServerSelectionTimeout).
		SetAppName(cfg.ServiceName).
		SetRetryWrites(true).
		SetRetryReads(true)

	delay := 500 * time.Millisecond
	var lastErr error
	for attempt := 1; attempt <= 10; attempt++ {
		client, err := mongo.Connect(ctx, opts)
		if err != nil {
			lastErr = err
		} else {
			// Verify with a ping
			pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			err := client.Ping(pingCtx, nil)
			cancel()
			if err != nil {
				_ = client.Disconnect(context.Background())
				lastErr = err
			} else {
				return client, nil
			}
		}

		log.Warn("mongo_connect_retry",
			zap.Int("attempt", attempt),
			zap.Duration("retry_in", delay),
			zap.Error(lastErr),
		)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		delay = minDuration(delay*2, 10*time.Second)
	}
	return nil, fmt.Errorf("could not connect to mongo after 10 attempts: %w", lastErr)
}

// newRedisClient creates and verifies a Redis client.
func newRedisClient(ctx context.Context, cfg *config.Config, log *zap.Logger) (*redis.Client, error) {
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	opts.MaxRetries = 3
	opts.DialTimeout = 5 * time.Second
	opts.ReadTimeout = 3 * time.Second
	opts.WriteTimeout = 3 * time.Second

	rdb := redis.NewClient(opts)

	delay := 500 * time.Millisecond
	var lastErr error
	for attempt := 1; attempt <= 5; attempt++ {
		if err := rdb.Ping(ctx).Err(); err == nil {
			return rdb, nil
		} else {
			lastErr = err
		}
		log.Warn("redis_connect_retry",
			zap.Int("attempt", attempt),
			zap.Duration("retry_in", delay),
			zap.Error(lastErr),
		)
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		delay = minDuration(delay*2, 5*time.Second)
	}
	return nil, fmt.Errorf("could not connect to redis after 5 attempts: %w", lastErr)
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}