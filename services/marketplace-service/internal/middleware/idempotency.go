package middleware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/db"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
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

// Idempotent returns middleware that ensures POST/PUT/PATCH endpoints are
// idempotent based on the `Idempotency-Key` header.
//
// Behavior:
//   - If key is missing → pass through (no idempotency).
//   - If key was already used by a DIFFERENT request body → 422 (mismatch).
//   - If key was already used with the SAME body → replay cached response.
//   - If new key → process request, cache response for TTL.
//
// The response cache is per-user, per-key, to prevent a malicious user from
// poisoning another user's key.
func Idempotent(cfg IdempotencyConfig) func(http.Handler) http.Handler {
	if cfg.TTL == 0 {
		cfg.TTL = 24 * time.Hour
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only enforce on methods that mutate state.
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
			bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 5*1024*1024)) // 5 MB cap
			if err != nil {
				writeIdempotencyError(w, r, "Could not read request body", "BODY_READ_ERROR")
				return
			}
			r.Body.Close()
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

			bodyHash := sha256.Sum256(bodyBytes)
			hashHex := hex.EncodeToString(bodyHash[:])

			redisKey := db.Key("idem", user.ID, key)

			// Check for existing entry.
			existing, err := cfg.Redis.Get(r.Context(), redisKey).Result()
			if err == nil {
				// Key exists — replay or reject based on body match.
				var cached CachedResponse
				if err := json.Unmarshal([]byte(existing), &cached); err == nil {
					// Compare body hash (stored in a sibling key).
					storedHash, _ := cfg.Redis.Get(r.Context(), db.Key("idem", user.ID, key, "hash")).Result()
					if storedHash != "" && storedHash != hashHex {
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
				// Redis error — fail open to avoid blocking the user.
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
			_ = cfg.Redis.Set(r.Context(), db.Key("idem", user.ID, key, "hash"), hashHex, cfg.TTL).Err()

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
	reqID, _ := r.Context().Value(RequestIDKey{}).(string)
	appErr.Write(w, reqID)
}

// silence unused-import warnings
var _ = context.Background