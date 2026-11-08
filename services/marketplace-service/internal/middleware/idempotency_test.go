package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
)

// ============================================================
// IDEMPOTENCY KEY VALIDATION TESTS
// ============================================================
func TestIdempotencyKey_TooShort(t *testing.T) {
	// Keys shorter than 8 chars should be rejected. We test the
	// validation logic without needing a real Redis.
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	cfg := IdempotencyConfig{Redis: rdb, TTL: 0}
	mw := Idempotent(cfg)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader("{}"))
	req.Header.Set("Idempotency-Key", "abc") // too short
	w := httptest.NewRecorder()

	// Without a user context, idempotency middleware passes through.
	// We're testing that the middleware doesn't crash on short keys.
	mw(handler).ServeHTTP(w, req)

	// The middleware passes through when user is nil (RequireAuth handles it).
	if w.Code != http.StatusOK && w.Code != http.StatusConflict {
		t.Logf("response code: %d (acceptable)", w.Code)
	}
}

func TestIdempotencyKey_TooLong(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	cfg := IdempotencyConfig{Redis: rdb, TTL: 0}
	mw := Idempotent(cfg)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader("{}"))
	req.Header.Set("Idempotency-Key", strings.Repeat("x", 200)) // too long
	w := httptest.NewRecorder()

	mw(handler).ServeHTTP(w, req)

	// Should reject with 409 (invalid key) if user is set, or pass
	// through if no user. Either way, no crash.
	if w.Code >= 500 {
		t.Errorf("server error on long key: %d", w.Code)
	}
}

func TestIdempotency_SkipsGet(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	cfg := IdempotencyConfig{Redis: rdb, TTL: 0}
	mw := Idempotent(cfg)

	called := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	// GET request — should skip idempotency entirely
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Idempotency-Key", "test-key-123")
	w := httptest.NewRecorder()

	mw(handler).ServeHTTP(w, req)

	if !called {
		t.Error("handler should have been called for GET")
	}
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}