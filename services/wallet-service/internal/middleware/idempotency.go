package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/db"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// IdempotencyConfig configures the idempotency middleware.
type IdempotencyConfig struct {
	Redis *redis.Client
	TTL   time.Duration // default 24h
}

// CachedResponse holds a previously computed response for replay.
type CachedResponse struct {
	Status int               `json:"status"`
	Body   []byte            `json:"body"`
	Header map[string]string `json:"header"`
}

// Idempotent returns middleware that ensures POST/PUT/PATCH requests
// with an `Idempotency-Key` header are processed exactly once.
//
// Behavior:
//   - If key is missing → pass through (no idempotency).
//   - If key was already used with a DIFFERENT body → 422 (mismatch).
//   - If key was already used with the SAME body → replay cached response.
//   - If new key → process request, cache response for TTL.
//   - If another request with the same key is in progress → 409.
//
// The cache is per-user, per-key, to prevent cross-user poisoning.
//
// Security note: this middleware is CRITICAL for payout endpoints. Without
// it, a user could double-click "Request payout" and trigger two Stripe
// transfers. Always mount this on payment-mutation routes.
func Idempotent(cfg IdempotencyConfig) func(http.Handler) http.Handler {
	if cfg.TTL == 0 {
		cfg.TTL = 24 * time.Hour
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only enforce on state-mutating methods.
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch:
			default:
				next.ServeHTTP(w, r)
				return
			}

			key := r.Header.Get("Idempotency-Key")
			if key == "" {
				next.ServeHTTP(w, r)
				return
			}
			if len(key) < 8 || len(key) > 128 {
				writeIdempotencyError(w, r, "Idempotency-Key must be 8–128 characters", "INVALID_IDEMPOTENCY_KEY")
				return
			}

			user := UserFromContext(r.Context())
			if user == nil {
				// Not authenticated — let RequireAuth reject it.
				next.ServeHTTP(w, r)
				return
			}

			// Read + restore body so we can hash it.
			bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 1*1024*1024)) // 1 MB cap (payout requests are small)
			if err != nil {
				writeIdempotencyError(w, r, "Could not read request body", "BODY_READ_ERROR")
				return
			}
			r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

			// Hash body (SHA-256 via helper)
			bodyHash := sha256Hex(bodyBytes)

			redisKey := db.Key("idem", user.ID, key)
			hashKey := db.Key("idem", user.ID, key, "hash")

			// Check for existing entry.
			existing, err := cfg.Redis.Get(r.Context(), redisKey).Result()
			if err == nil {
				// Key exists — replay or reject based on body match.
				var cached CachedResponse
				if err := json.Unmarshal([]byte(existing), &cached); err == nil {
					storedHash, _ := cfg.Redis.Get(r.Context(), hashKey).Result()
					if storedHash != "" && storedHash != bodyHash {
						writeIdempotencyError(w, r,
							"Idempotency-Key was already used with a different request body",
							"IDEMPOTENCY_MISMATCH")
						return
					}
					// Replay cached response.
					for k, v := range cached.Header {
						w.Header().Set(k, v)
					}
					w.Header().Set("Idempotency-Replayed", "true")
					w.WriteHeader(cached.Status)
					_, _ = w.Write(cached.Body)
					return
				}
				// Corrupted cache entry — treat as new.
				_ = cfg.Redis.Del(r.Context(), redisKey).Err()
			} else if err != redis.Nil {
				// Redis error — fail open (don't block the user).
				utils.LoggerFromCtx(r.Context()).Warn("idempotency_redis_error", zap.Error(err))
			}

			// Reserve the key BEFORE processing (prevents concurrent duplicates).
			lockTTL := 30 * time.Second
			ok, err := cfg.Redis.SetNX(r.Context(), redisKey, "__in_progress__", lockTTL).Result()
			if err != nil {
				// Fail open.
				utils.LoggerFromCtx(r.Context()).Warn("idempotency_lock_error", zap.Error(err))
			} else if !ok {
				// Another request holds the lock — reject with 409.
				writeIdempotencyError(w, r,
					"A request with this Idempotency-Key is already in progress",
					"IDEMPOTENCY_IN_PROGRESS")
				return
			}
			// Store the body hash for later mismatch detection.
			_ = cfg.Redis.Set(r.Context(), hashKey, bodyHash, cfg.TTL).Err()

			// Wrap the writer to capture the response.
			rec := &responseRecorder{
				ResponseWriter: w,
				status:         200,
				header:         make(map[string]string),
			}

			// Process.
			next.ServeHTTP(rec, r)

			// Cache only successful (2xx) or known-idempotent (4xx) responses.
			// Do NOT cache 5xx — those should be retryable.
			if rec.status >= 200 && rec.status < 500 {
				cached := CachedResponse{
					Status: rec.status,
					Body:   rec.body.Bytes(),
					Header: filterHeaders(rec.header),
				}
				data, _ := json.Marshal(cached)
				_ = cfg.Redis.Set(r.Context(), redisKey, data, cfg.TTL).Err()
			} else {
				// Remove the lock so the client can retry.
				_ = cfg.Redis.Del(r.Context(), redisKey).Err()
			}
		})
	}
}

// responseRecorder captures the response body + status + headers.
type responseRecorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
	header map[string]string
}

func (r *responseRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func (r *responseRecorder) Header() http.Header {
	h := r.ResponseWriter.Header()
	for k := range h {
		if isReplayableHeader(k) {
			r.header[k] = h.Get(k)
		}
	}
	return h
}

// isReplayableHeader returns true for headers safe to replay from cache.
func isReplayableHeader(k string) bool {
	switch http.CanonicalHeaderKey(k) {
	case "Content-Type", "Location", "X-Request-Id":
		return true
	}
	return false
}

func filterHeaders(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

func writeIdempotencyError(w http.ResponseWriter, r *http.Request, detail, code string) {
	appErr := utils.Conflict(detail, code)
	reqID := RequestIDFromContext(r.Context())
	appErr.Write(w, reqID)
}

// sha256Hex is a small helper (imported from crypto/sha256).
func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}