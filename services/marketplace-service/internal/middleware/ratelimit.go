package middleware

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/db"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// RateLimitConfig configures the Redis-backed rate limiter.
type RateLimitConfig struct {
	Redis  *redis.Client
	Window time.Duration // e.g., 1 minute
	Max    int           // e.g., 100
	// Prefix distinguishes different limiters (e.g., "global", "checkout").
	Prefix string
	// KeyByUser uses the authenticated user ID instead of the IP.
	// Useful for expensive endpoints (checkout, refunds).
	KeyByUser bool
}

// RateLimit returns middleware that enforces per-IP (or per-user) rate
// limits using a sliding-window counter in Redis.
//
// The counter key format: `market:rl:{prefix}:{identifier}:{window_bucket}`.
// The bucket is the unix-second window (`floor(now / windowSeconds)`).
//
// This is a "fixed window" implementation — cheap and predictable, but
// allows bursts at window boundaries (e.g., 2x max in a ~2s span). For
// this use case that's acceptable; Redis sliding-window is more expensive.
func RateLimit(cfg RateLimitConfig) func(http.Handler) http.Handler {
	if cfg.Window == 0 {
		cfg.Window = time.Minute
	}
	if cfg.Max <= 0 {
		cfg.Max = 100
	}
	if cfg.Prefix == "" {
		cfg.Prefix = "default"
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip health/readiness/metrics
			switch r.URL.Path {
			case "/health", "/ready", "/metrics":
				next.ServeHTTP(w, r)
				return
			}

			identifier := extractRateLimitID(r, cfg.KeyByUser)
			windowSecs := int64(cfg.Window.Seconds())
			bucket := time.Now().Unix() / windowSecs

			key := db.Key("rl", cfg.Prefix, identifier, strconv.FormatInt(bucket, 10))

			count, err := cfg.Redis.Incr(r.Context(), key).Result()
			if err != nil {
				// Fail open — don't block the user if Redis is down.
				utils.LoggerFromCtx(r.Context()).Warn("ratelimit_redis_error", zap.Error(err))
				next.ServeHTTP(w, r)
				return
			}
			if count == 1 {
				// First request in this window — set TTL.
				_ = cfg.Redis.Expire(r.Context(), key, cfg.Window).Err()
			}

			remaining := int64(cfg.Max) - count
			if remaining < 0 {
				remaining = 0
			}

			// Standard headers.
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(cfg.Max))
			w.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(remaining, 10))
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt((bucket+1)*windowSecs, 10))

			if count > int64(cfg.Max) {
				retryAfter := (bucket+1)*windowSecs - time.Now().Unix()
				w.Header().Set("Retry-After", strconv.FormatInt(retryAfter, 10))

				appErr := utils.TooManyRequests(
					fmt.Sprintf("Rate limit exceeded (%d requests per %s)", cfg.Max, cfg.Window),
					"RATE_LIMITED",
				)
				reqID := RequestIDFromContext(r.Context())
				appErr.Write(w, reqID)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// extractRateLimitID returns the key suffix for the rate limiter.
//   - Per-user: "u:{user_id}" (falls back to IP if unauthenticated).
//   - Per-IP:   "ip:{remote_addr}"
func extractRateLimitID(r *http.Request, keyByUser bool) string {
	if keyByUser {
		if u := UserFromContext(r.Context()); u != nil {
			return "u:" + u.ID
		}
	}
	// Respect X-Forwarded-For (we set trust proxy in Nginx).
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the chain.
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return "ip:" + xff[:i]
			}
		}
		return "ip:" + xff
	}
	return "ip:" + r.RemoteAddr
}