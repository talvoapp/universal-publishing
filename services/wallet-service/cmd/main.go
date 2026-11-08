// Package main is the entry point for the wallet-service binary.
//
// Startup order:
//  1. Load config (fails fast on invalid env)
//  2. Initialize logger
//  3. Connect to PostgreSQL (with retries)
//  4. Connect to Redis
//  5. Initialize Stripe client (Connect)
//  6. Initialize Kafka consumer
//  7. Start HTTP server + consumer
//  8. Wait for SIGTERM/SIGINT → graceful shutdown
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
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/consumer"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/server"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
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

	// ----- 4. PostgreSQL -----
	db, err := newPostgresPool(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("postgres_init_failed", zap.Error(err))
	}
	logger.Info("postgres_connected")

	// ----- 5. Redis -----
	rdb, err := newRedisClient(ctx, cfg, logger)
	if err != nil {
		logger.Fatal("redis_init_failed", zap.Error(err))
	}
	logger.Info("redis_connected")

	// ----- 6. Stripe -----
	stripeClient := &client.API{}
	stripeClient.Init(cfg.StripeSecretKey, nil)
	stripe.Key = cfg.StripeSecretKey
	logger.Info("stripe_initialized")

	// ----- 7. Kafka consumer -----
	kafkaConsumer := consumer.NewEventConsumer(consumer.Config{
		Brokers:       cfg.KafkaBrokerList(),
		Topic:         cfg.KafkaOutboxTopic,
		GroupID:       cfg.KafkaConsumerGroup,
		ClientID:      cfg.KafkaClientID,
		DB:            db,
		Redis:         rdb,
		Stripe:        stripeClient,
		Logger:        logger,
		PlatformFeePct: cfg.PlatformFeePercent,
	})
	logger.Info("kafka_consumer_ready")

	// ----- 8. Server -----
	srv := server.New(server.Deps{
		Cfg:      cfg,
		Log:      logger,
		DB:       db,
		Redis:    rdb,
		Stripe:   stripeClient,
		Consumer: kafkaConsumer,
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