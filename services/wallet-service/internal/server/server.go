// Package server wires together the HTTP server, database pool, Redis,
// Kafka consumer, and Stripe client into a lifecycle-managed Server.
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/consumer"
)

// Server owns all long-lived dependencies for the service.
type Server struct {
	cfg        *config.Config
	log        *zap.Logger
	http       *http.Server
	db         *pgxpool.Pool
	redis      *redis.Client
	stripe     *client.API
	consumer   *consumer.EventConsumer
}

// Deps groups all external dependencies the server needs.
type Deps struct {
	Cfg      *config.Config
	Log      *zap.Logger
	DB       *pgxpool.Pool
	Redis    *redis.Client
	Stripe   *client.API
	Consumer *consumer.EventConsumer
}

// New creates a Server from the given dependencies.
func New(deps Deps) *Server {
	return &Server{
		cfg:      deps.Cfg,
		log:      deps.Log,
		db:       deps.DB,
		redis:    deps.Redis,
		stripe:   deps.Stripe,
		consumer: deps.Consumer,
	}
}

// Start launches the HTTP server + Kafka consumer, and blocks until ctx
// is cancelled. On cancellation, performs graceful shutdown.
func (s *Server) Start(ctx context.Context) error {
	router := newRouter(s)
	router.Method("GET", "/metrics", promhttp.Handler())

	s.http = &http.Server{
		Addr:              fmt.Sprintf(":%d", s.cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// Start Kafka consumer in a goroutine
	if s.consumer != nil {
		go func() {
			if err := s.consumer.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				s.log.Error("kafka_consumer_error", zap.Error(err))
			}
		}()
		s.log.Info("kafka_consumer_started")
	}

	errCh := make(chan error, 1)
	go func() {
		s.log.Info("http_server_starting", zap.Int("port", s.cfg.Port))
		if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- fmt.Errorf("listen: %w", err)
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		s.log.Info("shutdown_initiated")
		return s.shutdown()
	}
}

// shutdown drains in-flight requests, then closes dependencies in reverse
// order of startup.
func (s *Server) shutdown() error {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1. Stop accepting new HTTP connections
	if err := s.http.Shutdown(shutdownCtx); err != nil {
		s.log.Error("http_shutdown_error", zap.Error(err))
	} else {
		s.log.Info("http_server_stopped")
	}

	// 2. Stop Kafka consumer (finishes current message)
	if s.consumer != nil {
		s.consumer.Close()
		s.log.Info("kafka_consumer_stopped")
	}

	// 3. Close Redis
	if s.redis != nil {
		if err := s.redis.Close(); err != nil {
			s.log.Error("redis_close_error", zap.Error(err))
		} else {
			s.log.Info("redis_closed")
		}
	}

	// 4. Close Postgres last
	if s.db != nil {
		s.db.Close()
		s.log.Info("postgres_closed")
	}

	s.log.Info("shutdown_complete")
	return nil
}