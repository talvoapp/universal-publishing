// Package server wires together the HTTP server, DB pool, Mongo client,
// and Redis client for content-service.
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
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/config"
)

// Server owns all long-lived dependencies.
type Server struct {
	cfg   *config.Config
	log   *zap.Logger
	http  *http.Server
	db    *pgxpool.Pool
	mongo *mongo.Client
	redis *redis.Client
}

// Deps groups external dependencies.
type Deps struct {
	Cfg   *config.Config
	Log   *zap.Logger
	DB    *pgxpool.Pool
	Mongo *mongo.Client
	Redis *redis.Client
}

// New creates a Server.
func New(deps Deps) *Server {
	return &Server{
		cfg:   deps.Cfg,
		log:   deps.Log,
		db:    deps.DB,
		mongo: deps.Mongo,
		redis: deps.Redis,
	}
}

// Start launches the HTTP server and blocks until ctx is cancelled.
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

// shutdown drains in-flight requests and closes dependencies in reverse
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

	// 2. Close Redis
	if s.redis != nil {
		if err := s.redis.Close(); err != nil {
			s.log.Error("redis_close_error", zap.Error(err))
		} else {
			s.log.Info("redis_closed")
		}
	}

	// 3. Disconnect Mongo
	if s.mongo != nil {
		mongoCtx, mongoCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer mongoCancel()
		if err := s.mongo.Disconnect(mongoCtx); err != nil {
			s.log.Error("mongo_disconnect_error", zap.Error(err))
		} else {
			s.log.Info("mongo_disconnected")
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