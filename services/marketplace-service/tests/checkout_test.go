//go:build integration

package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stripe/stripe-go/v76/client"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/handlers"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/middleware"
)

// ============================================================
// CHECKOUT INTEGRATION TESTS
// ============================================================
// These tests verify the checkout flow. They mock Stripe (via a stub
// HTTP transport in the client.API), so no real API calls are made.

func newCheckoutHandler(t *testing.T, env *TestEnv) *handlers.CheckoutHandler {
	t.Helper()

	cfg := &config.Config{
		StripeSecretKey:      "sk_test_fake",
		StripePublishableKey: "pk_test_fake",
		PlatformFeePercent:   15,
	}

	// Stripe client with a stub transport that returns canned responses
	stripeClient := &client.API{}
	stripeClient.Init(cfg.StripeSecretKey, &stubStripeBackend{t: t})

	return handlers.NewCheckoutHandler(
		cfg,
		env.DB,
		env.Redis,
		stripeClient,
		nil, // no publisher for tests
		env.Log,
	)
}

// ============================================================
// TESTS
// ============================================================

func TestCheckout_RequiresAuth(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	h := newCheckoutHandler(t, env)

	body := map[string]any{
		"itemId":     uuid.NewString(),
		"successUrl": "https://example.com/success",
		"cancelUrl":  "https://example.com/cancel",
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout", bytes.NewReader(bodyBytes))
	// No auth context → middleware.UserFromContext returns nil
	w := httptest.NewRecorder()
	h.Initiate(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

func TestCheckout_InvalidBody_Returns400(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	h := newCheckoutHandler(t, env)

	req := withUser(
		httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout",
			bytes.NewReader([]byte(`not-json`))),
		uuid.NewString(),
	)
	w := httptest.NewRecorder()
	h.Initiate(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCheckout_MissingURLs_Returns400(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	itemID := env.SeedItem(t, uuid.NewString(), uuid.NewString(), 1299)
	h := newCheckoutHandler(t, env)

	body := map[string]any{
		"itemId": itemID,
		// missing successUrl + cancelUrl
	}
	bodyBytes, _ := json.Marshal(body)
	req := withUser(
		httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout", bytes.NewReader(bodyBytes)),
		uuid.NewString(),
	)
	w := httptest.NewRecorder()
	h.Initiate(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCheckout_NonExistentItem_Returns404(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	h := newCheckoutHandler(t, env)

	body := map[string]any{
		"itemId":     uuid.NewString(), // not in DB
		"successUrl": "https://example.com/success",
		"cancelUrl":  "https://example.com/cancel",
	}
	bodyBytes, _ := json.Marshal(body)
	req := withUser(
		httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout", bytes.NewReader(bodyBytes)),
		uuid.NewString(),
	)
	w := httptest.NewRecorder()
	h.Initiate(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCheckout_UnpublishedItem_Returns404(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	var itemID string
	err := env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Hidden', 'USD', 1299, FALSE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)
	if err != nil {
		t.Fatalf("seed unpublished: %v", err)
	}

	h := newCheckoutHandler(t, env)

	body := map[string]any{
		"itemId":     itemID,
		"successUrl": "https://example.com/success",
		"cancelUrl":  "https://example.com/cancel",
	}
	bodyBytes, _ := json.Marshal(body)
	req := withUser(
		httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout", bytes.NewReader(bodyBytes)),
		uuid.NewString(),
	)
	w := httptest.NewRecorder()
	h.Initiate(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestCheckout_ConfirmNonExistentOrder_Returns404(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	h := newCheckoutHandler(t, env)

	r := httptest.NewRequest(http.MethodPost,
		"/api/v1/market/checkout/"+uuid.NewString()+"/confirm",
		nil)
	r = withUser(r, uuid.NewString())

	// Wrap with chi router to set URL param
	w := httptest.NewRecorder()
	h.Confirm(w, withChiParam(r, "checkoutID", uuid.NewString()))

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestCheckout_ConfirmExistingOrder(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	buyerID := uuid.NewString()
	authorID := uuid.NewString()
	itemID := env.SeedItem(t, authorID, uuid.NewString(), 1299)
	orderID := env.SeedOrder(t, buyerID, itemID, authorID, "succeeded")

	h := newCheckoutHandler(t, env)
	r := httptest.NewRequest(http.MethodPost, "/api/v1/market/checkout/"+orderID+"/confirm", nil)
	r = withUser(r, buyerID)
	r = withChiParam(r, "checkoutID", orderID)

	w := httptest.NewRecorder()
	h.Confirm(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp["payment_done"] != true {
		t.Errorf("expected payment_done=true")
	}
}

// ============================================================
// HELPERS
// ============================================================

// withUser injects an authenticated user into the request context.
// This is what RequireAuth middleware does in production.
func withUser(r *http.Request, userID string) *http.Request {
	user := &middleware.UserContext{
		ID:            userID,
		Email:         "test@example.com",
		Role:          middleware.RoleAuthor,
		EmailVerified: true,
	}
	ctx := context.WithValue(r.Context(), middleware.UserContextKey{}, user)
	return r.WithContext(ctx)
}

// withChiParam injects a chi URL param (normally set by chi.Router).
func withChiParam(r *http.Request, key, value string) *http.Request {
	rctx := chiRouteContextWith(r.Context(), key, value)
	return r.WithContext(rctx)
}

// ============================================================
// STUB STRIPE BACKEND (mocks HTTP calls from stripe-go)
// ============================================================
type stubStripeBackend struct {
	t *testing.T
}

// Call implements stripe.Backend.
func (s *stubStripeBackend) Call(method, path, key string, params stripe.ParamsContainer, v stripe.LastResponseSetter) error {
	// Return a fake success response for checkout session creation
	if path == "/v1/checkout/sessions" {
		body := `{
			"id": "cs_test_123",
			"url": "https://checkout.stripe.com/pay/cs_test_123",
			"object": "checkout.session"
		}`
		return json.Unmarshal([]byte(body), v)
	}
	s.t.Logf("stub stripe: unexpected call to %s %s", method, path)
	return nil
}

func (s *stubStripeBackend) CallStreaming(method, path, key string, params stripe.ParamsContainer, v stripe.StreamingLastResponseSetter) error {
	return nil
}

func (s *stubStripeBackend) CallRaw(method, path, key string, body *stripe.RequestValues, v interface{}) error {
	return nil
}

func (s *stubStripeBackend) CallMultipart(method, path, key, boundary string, body *bytes.Buffer, v stripe.LastResponseSetter) error {
	return nil
}

func (s *stubStripeBackend) SetMaxNetworkRetries(n int) {}