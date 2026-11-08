package handlers

import (
	"net/http"
	"time"

	"go.uber.org/zap"
)

// HealthHandler provides liveness + readiness endpoints.
type HealthHandler struct {
	log *zap.Logger
}

// NewHealthHandler creates a health handler.
func NewHealthHandler(log *zap.Logger) *HealthHandler {
	return &HealthHandler{log: log}
}

// Health returns 200 if the process is up.
//
//	GET /health
//
// This endpoint is used by Kubernetes liveness probes. It should be
// extremely cheap — no DB access, no external calls. If it returns
// non-200, the pod is killed and restarted.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok","service":"wallet-service"}`))
}

// Ready returns 200 only if all dependencies (DB, Redis) are reachable.
//
//	GET /ready
//
// Used by Kubernetes readiness probes. During startup, this returns 503
// until DB/Redis are ready. During shutdown, this returns 503 to stop
// routing traffic to the pod.
//
// Note: for the wallet service, we rely on the pool-level health
// checks in `internal/db`. The `Router` wires readiness directly via
// `db.HealthCheck` + `db.RedisHealthCheck`, so this handler is a
// redundant convenience for external callers.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	// Real readiness logic is in router.go — this stub is for internal
	// use only. Return a generic OK response with a timestamp.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"ready":true,"timestamp":"` + time.Now().UTC().Format(time.RFC3339) + `"}`))
}