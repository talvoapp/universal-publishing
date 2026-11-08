package middleware

import (
	"net/http"
	"runtime/debug"

	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// ErrorHandler wraps downstream handlers with panic recovery + RFC 7807.
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
					detail := "An unexpected error occurred"
					if !isProd {
						detail = "Panic: " + sprint(rec)
					}
					utils.Internal(detail, nil).Write(w, reqID)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// JSONErrorWriter writes an AppError as a response.
func JSONErrorWriter(w http.ResponseWriter, r *http.Request, err error) {
	reqID := RequestIDFromContext(r.Context())
	utils.AsAppError(err).Write(w, reqID)
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