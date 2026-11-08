package middleware

import (
	"net/http"
	"runtime/debug"

	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// ErrorHandler is a middleware that wraps the downstream handler in a
// panic-recovery + error-serialization layer.
//
// Handlers should return errors via a custom `http.HandlerFunc` variant
// (see `server.NewHandler`) OR throw `*utils.AppError` and let this
// middleware format it. In practice we always recover from panics and
// produce a clean RFC 7807 response — never a stack trace in prod.
func ErrorHandler(log *zap.Logger, isProd bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqID := RequestIDFromContext(r.Context())

			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic_recovered",
						zap.Any("panic", rec),
						zap.String("request_id", reqID),
						zap.String("path", r.URL.Path),
						zap.String("method", r.Method),
						zap.ByteString("stack", debug.Stack()),
					)

					appErr := utils.Internal("An unexpected error occurred", nil)
					if isProd {
						appErr.Detail = "An unexpected error occurred"
					} else {
						appErr.Detail = "Panic: " + sprint(rec)
					}
					appErr.Write(w, reqID)
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// JSONErrorWriter is a helper for handlers that return errors directly
// (instead of using the middleware-level panic handler).
func JSONErrorWriter(w http.ResponseWriter, r *http.Request, err error) {
	appErr := utils.AsAppError(err)
	reqID := RequestIDFromContext(r.Context())
	appErr.Write(w, reqID)
}

func sprint(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if e, ok := v.(error); ok {
		return e.Error()
	}
	return "unknown error"
}