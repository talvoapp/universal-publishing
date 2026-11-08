// Package middleware — request context helpers (Request ID, tracing).
package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

// RequestIDKey is the context key for the request ID.
type RequestIDKey struct{}

// RequestIDFromContext returns the request ID from the context, or "".
func RequestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(RequestIDKey{}).(string); ok {
		return id
	}
	return ""
}

// RequestID returns middleware that extracts (or generates) a request ID
// and stores it in both the request context and the `X-Request-ID` response
// header. This value is used by:
//   - The error middleware (RFC 7807 `instance` field)
//   - The logger (structured logs)
//   - The outbox (correlation between HTTP request and Kafka event)
func RequestID() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := r.Header.Get("X-Request-ID")

			// Validate client-supplied ID (don't blindly trust it).
			if !isValidRequestID(id) {
				id = uuid.NewString()
			}

			ctx := context.WithValue(r.Context(), RequestIDKey{}, id)
			w.Header().Set("X-Request-ID", id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// isValidRequestID returns true if the given ID looks like a well-formed
// UUID or a reasonable alphanumeric identifier (8-128 chars, safe chars).
func isValidRequestID(id string) bool {
	if len(id) < 8 || len(id) > 128 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}