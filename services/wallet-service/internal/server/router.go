package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/db"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/handlers"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// newRouter builds the chi router for the wallet service.
func newRouter(s *Server) *chi.Mux {
	r := chi.NewRouter()

	// Core middleware
	r.Use(middleware.RequestID())
	r.Use(chimw.RealIP)
	r.Use(chimw.Timeout(60 * time.Second))
	r.Use(middleware.ErrorHandler(s.log, s.cfg.IsProd()))

	// Request logger
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			reqID := middleware.RequestIDFromContext(req.Context())
			reqLog := s.log.With(
				zap.String("request_id", reqID),
				zap.String("method", req.Method),
				zap.String("path", req.URL.Path),
			)
			next.ServeHTTP(w, req.WithContext(utils.WithLogger(req.Context(), reqLog)))
		})
	})

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOriginsList(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))

	// Health
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": s.cfg.ServiceName,
			"version": s.cfg.ServiceVersion,
		})
	})

	r.Get("/ready", func(w http.ResponseWriter, req *http.Request) {
		ctx := req.Context()
		pgOK := db.HealthCheck(ctx, s.db)
		redisOK := db.RedisHealthCheck(ctx, s.redis)
		ready := pgOK && redisOK
		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, map[string]any{
			"ready": ready,
			"checks": map[string]string{
				"postgres": boolToOK(pgOK),
				"redis":    boolToOK(redisOK),
			},
		})
	})

	// API v1
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.RequireAuth(s.cfg))

		// Idempotency — CRITICAL for payout endpoints
		r.Use(middleware.Idempotent(middleware.IdempotencyConfig{
			Redis: s.redis,
			TTL:   24 * time.Hour,
		}))

		walletH := handlers.NewWalletHandler(s.cfg, s.db, s.log)
		ledgerH := handlers.NewLedgerHandler(s.cfg, s.db, s.log)
		payoutH := handlers.NewPayoutHandler(s.cfg, s.db, s.stripe, s.log)
		connectH := handlers.NewConnectHandler(s.cfg, s.db, s.stripe, s.log)
		analyticsH := handlers.NewAnalyticsHandler(s.cfg, s.db, s.log)

		r.Route("/wallet", func(r chi.Router) {
			r.Get("/", walletH.Get)
			r.Get("/ledger", ledgerH.List)
			r.Get("/analytics", analyticsH.Get)
			r.Post("/payouts/request", payoutH.Request)
			r.Get("/payouts", payoutH.List)
			r.Post("/connect/onboard", connectH.Onboard)
			r.Get("/connect/status", connectH.Status)
		})
	})

	// 404
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		reqID := middleware.RequestIDFromContext(req.Context())
		utils.NotFound("Route not found", "NOT_FOUND").Write(w, reqID)
	})

	return r
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func boolToOK(b bool) string {
	if b {
		return "ok"
	}
	return "fail"
}