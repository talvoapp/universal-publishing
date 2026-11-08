package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/db"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/handlers"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// newRouter builds the complete chi router for the marketplace service.
func newRouter(s *Server) *chi.Mux {
	r := chi.NewRouter()

	// ---------- Core middleware ----------
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
				zap.String("remote_addr", req.RemoteAddr),
			)
			ctx := utils.WithLogger(req.Context(), reqLog)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOriginsList(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "If-Match"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After", "Idempotency-Replayed"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))

	// Global rate limit
	r.Use(middleware.RateLimit(middleware.RateLimitConfig{
		Redis:  s.redis,
		Window: s.cfg.RateLimitWindow,
		Max:    s.cfg.RateLimitMax,
		Prefix: "global",
	}))

	// ---------- Health + readiness ----------
	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
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

	// ---------- API v1 (auth required) ----------
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.RequireAuth(s.cfg))
		r.Use(middleware.Idempotent(middleware.IdempotencyConfig{
			Redis: s.redis,
			TTL:   s.cfg.IdempotencyTTL,
		}))

		catalogH := handlers.NewCatalogHandler(s.cfg, s.db, s.log)
		checkoutH := handlers.NewCheckoutHandler(s.cfg, s.db, s.redis, s.stripe, s.publisher, s.log)
		subscriptionH := handlers.NewSubscriptionHandler(s.cfg, s.db, s.stripe, s.publisher, s.log)
		refundH := handlers.NewRefundHandler(s.cfg, s.db, s.stripe, s.publisher, s.log)

		r.Route("/market", func(r chi.Router) {
			r.Get("/items", catalogH.List)
			r.Get("/items/{itemID}", catalogH.Get)
			r.Get("/items/{itemID}/chapters", catalogH.ListChapters)

			r.Group(func(r chi.Router) {
				r.Use(middleware.RateLimit(middleware.RateLimitConfig{
					Redis:     s.redis,
					Window:    time.Second,
					Max:       1,
					Prefix:    "checkout",
					KeyByUser: true,
				}))
				r.Post("/checkout", checkoutH.Initiate)
				r.Post("/checkout/{checkoutID}/confirm", checkoutH.Confirm)
			})

			r.Post("/subscriptions", subscriptionH.Create)
			r.Get("/subscriptions", subscriptionH.List)
			r.Delete("/subscriptions/{subscriptionID}", subscriptionH.Cancel)

			r.Post("/orders/{orderID}/refund", refundH.Issue)
		})
	})

	// ---------- Stripe webhook ----------
	r.Route("/webhooks/stripe", func(r chi.Router) {
		webhookH := handlers.NewWebhookHandler(s.cfg, s.db, s.redis, s.publisher, s.log)
		r.Post("/", webhookH.Handle)
	})

	// ---------- 404 ----------
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