package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/db"
	"github.com/talvoapp/universal-publishing/feed-service/internal/handlers"
	"github.com/talvoapp/universal-publishing/feed-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/feed-service/internal/utils"
)

// newRouter builds the chi router for feed-service.
func newRouter(s *Server) *chi.Mux {
	r := chi.NewRouter()

	// ----- Core middleware -----
	r.Use(middleware.RequestID())
	r.Use(chimw.RealIP)
	r.Use(chimw.Timeout(30 * time.Second))
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
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"X-Request-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"},
		AllowCredentials: true,
		MaxAge:           86400,
	}))

	// ----- Health & readiness -----
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

	// ----- Handlers (shared across public + auth routes) -----
	feedH := handlers.NewFeedHandler(s.cfg, s.db, s.redis, s.log)
	followH := handlers.NewFollowHandler(s.cfg, s.db, s.log)

	// ----- PUBLIC endpoints (no auth required) -----
	// Used by internal services (notification-service) to fetch
	// follower lists for fan-out. Rate-limit at nginx/Cloudflare.
	r.Get("/api/v1/follows/{userID}/followers", followH.ListUserFollowers)

	// ----- AUTHENTICATED endpoints -----
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.RequireAuth(s.cfg))

		// Feed reads
		r.Get("/feed", feedH.GetMyFeed)
		r.Get("/feed/user/{userID}", feedH.GetUserFeed)
		r.Get("/feed/author/{authorID}", feedH.GetAuthorPosts)

		// Follow operations (current user)
		r.Post("/follow/{userID}", followH.Follow)
		r.Delete("/follow/{userID}", followH.Unfollow)
		r.Get("/follow/followers", followH.ListFollowers)
		r.Get("/follow/following", followH.ListFollowing)
	})

	// ----- 404 -----
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