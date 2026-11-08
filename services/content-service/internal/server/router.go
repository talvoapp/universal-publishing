package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/cache"
	"github.com/talvoapp/universal-publishing/content-service/internal/db"
	"github.com/talvoapp/universal-publishing/content-service/internal/handlers"
	"github.com/talvoapp/universal-publishing/content-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// newRouter builds the chi router for content-service.
func newRouter(s *Server) *chi.Mux {
	r := chi.NewRouter()

	// ----------------------------------------------------------
	// Core middleware
	// ----------------------------------------------------------
	r.Use(middleware.RequestID())
	r.Use(chimw.RealIP)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(middleware.ErrorHandler(s.log, s.cfg.IsProd()))

	// Request logger — attaches a per-request logger to context.
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
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))

	// ----------------------------------------------------------
	// Health & readiness (before auth, before rate limit)
	// ----------------------------------------------------------
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
		mongoOK := db.MongoHealthCheck(ctx, s.mongo)
		redisOK := db.RedisHealthCheck(ctx, s.redis)
		ready := pgOK && mongoOK && redisOK
		status := http.StatusOK
		if !ready {
			status = http.StatusServiceUnavailable
		}
		writeJSON(w, status, map[string]any{
			"ready": ready,
			"checks": map[string]string{
				"postgres": boolToOK(pgOK),
				"mongodb":  boolToOK(mongoOK),
				"redis":    boolToOK(redisOK),
			},
		})
	})

	// ----------------------------------------------------------
	// Entitlement cache (shared across all requests)
	// ----------------------------------------------------------
	// The cache is created once and passed to the middleware. Its TTL
	// is configured via ENTITLEMENT_CACHE_TTL (default 5 min).
	entCache := cache.NewEntitlementCache(
		s.redis,
		s.cfg.EntitlementCacheTTL,
		s.log,
	)

	// ----------------------------------------------------------
	// API v1
	// ----------------------------------------------------------
	r.Route("/api/v1", func(r chi.Router) {
		// Auth required for every endpoint below.
		r.Use(middleware.RequireAuth(s.cfg))

		// Content handler is constructed once. Note: rdb is passed for
		// any future caching (e.g., metadata cache), though the current
		// implementation only uses the entitlement cache via middleware.
		contentH := handlers.NewContentHandler(s.cfg, s.db, s.mongo, s.redis, s.log)

		// --- Public reads (auth required, no entitlement check) ---
		r.Get("/content/{itemID}/metadata", contentH.GetMetadata)
		r.Get("/content/{itemID}/chapters", contentH.ListChapters)
		r.Get("/content/{itemID}/preview", contentH.GetPreview)
		r.Get("/content/{itemID}/chapters/{chapterID}/preview", contentH.GetChapterPreview)

		// --- Gated reads (entitlement enforced) ---
		r.Group(func(r chi.Router) {
			r.Use(middleware.EntitlementMiddleware(
				s.db,
				entCache,
				s.log,
			))
			r.Get("/content/{itemID}/read", contentH.ReadFullItem)
			r.Get("/content/{itemID}/chapters/{chapterID}/read", contentH.ReadChapter)
		})
	})

	// ----------------------------------------------------------
	// 404 handler
	// ----------------------------------------------------------
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		reqID := middleware.RequestIDFromContext(req.Context())
		utils.NotFound("Route not found", "NOT_FOUND").Write(w, reqID)
	})

	return r
}

// writeJSON writes a JSON response with the given status.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// boolToOK converts a health check bool to "ok"/"fail".
func boolToOK(b bool) string {
	if b {
		return "ok"
	}
	return "fail"
}