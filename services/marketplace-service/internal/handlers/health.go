// Package handlers implements HTTP request handlers.
package handlers

import (
	"net/http"

	"go.uber.org/zap"
)

// HealthHandler exposes liveness + readiness endpoints.
type HealthHandler struct {
	log *zap.Logger
}

// NewHealthHandler creates a health handler.
func NewHealthHandler(log *zap.Logger) *HealthHandler {
	return &HealthHandler{log: log}
}

// Health returns 200 if the process is up.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}