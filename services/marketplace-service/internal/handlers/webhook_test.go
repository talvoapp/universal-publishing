package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
)

// ============================================================
// WEBHOOK SIGNATURE VERIFICATION TESTS
// ============================================================
func TestWebhookHandler_MissingSignature(t *testing.T) {
	cfg := &config.Config{StripeWebhookSecret: "whsec_test_secret"}
	h := &WebhookHandler{cfg: cfg, log: zap.NewNop()}

	body := `{"type":"checkout.session.completed"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(body))
	w := httptest.NewRecorder()

	h.Handle(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestWebhookHandler_InvalidSignature(t *testing.T) {
	cfg := &config.Config{StripeWebhookSecret: "whsec_test_secret"}
	h := &WebhookHandler{cfg: cfg, log: zap.NewNop()}

	body := `{"type":"checkout.session.completed"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(body))
	req.Header.Set("Stripe-Signature", "t=123,v1=deadbeef")
	w := httptest.NewRecorder()

	h.Handle(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestWebhookHandler_BodyTooLarge(t *testing.T) {
	cfg := &config.Config{StripeWebhookSecret: "whsec_test_secret"}
	h := &WebhookHandler{cfg: cfg, log: zap.NewNop()}

	// 2MB body — should be rejected at read stage
	bigBody := strings.Repeat("a", 2*1024*1024)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/stripe", strings.NewReader(bigBody))
	req.Header.Set("Stripe-Signature", "t=123,v1=deadbeef")
	w := httptest.NewRecorder()

	h.Handle(w, req)

	// LimitReader truncates at 1MB, so body is read successfully but
	// signature is invalid — expected 400 (not 413, which would be a bug)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 (invalid signature), got %d", w.Code)
	}
}