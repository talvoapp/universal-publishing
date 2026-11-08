//go:build integration

package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/handlers"
)

// ============================================================
// CATALOG INTEGRATION TESTS
// ============================================================

func TestCatalog_ListPublishedItems(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	// Seed: 3 published
	env.SeedItem(t, authorID, uuid.NewString(), 1299)
	env.SeedItem(t, authorID, uuid.NewString(), 999)
	env.SeedItem(t, authorID, uuid.NewString(), 499)

	// Seed: 1 unpublished (must be hidden)
	_, err := env.DB.Exec(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Hidden Book', 'USD', 2999, FALSE)
	`, uuid.NewString(), authorID)
	if err != nil {
		t.Fatalf("seed unpublished item: %v", err)
	}

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items", nil)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Items      []map[string]any `json:"items"`
		NextCursor string           `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(resp.Items) != 3 {
		t.Errorf("expected 3 published items, got %d", len(resp.Items))
	}

	for _, it := range resp.Items {
		if it["title"] == "Hidden Book" {
			t.Errorf("unpublished item appeared in listing")
		}
	}
}

func TestCatalog_ListWithLimit(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	for i := 0; i < 5; i++ {
		env.SeedItem(t, authorID, uuid.NewString(), int64(1000+i*100))
	}

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items?limit=2", nil)
	w := httptest.NewRecorder()
	h.List(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Items      []map[string]any `json:"items"`
		NextCursor string           `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(resp.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(resp.Items))
	}
	if resp.NextCursor == "" {
		t.Errorf("expected next_cursor for paginated response")
	}
}

func TestCatalog_GetPublishedItem(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	itemID := env.SeedItem(t, authorID, uuid.NewString(), 1299)

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)
	r := chi.NewRouter()
	r.Get("/api/v1/market/items/{itemID}", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items/"+itemID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var item map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &item); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if item["title"] != "Test Book" {
		t.Errorf("wrong title: %v", item["title"])
	}
	if item["isPublished"] != true {
		t.Errorf("expected published")
	}
}

func TestCatalog_GetUnpublishedItem_Returns404(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	var itemID string
	err := env.DB.QueryRow(env.Ctx, `
		INSERT INTO items (draft_id, author_id, type, pricing_model, title, currency, price_cents, is_published)
		VALUES ($1, $2, 'book', 'pay_per_book', 'Draft Only', 'USD', 1299, FALSE)
		RETURNING id
	`, uuid.NewString(), authorID).Scan(&itemID)
	if err != nil {
		t.Fatalf("seed unpublished: %v", err)
	}

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)
	r := chi.NewRouter()
	r.Get("/api/v1/market/items/{itemID}", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items/"+itemID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unpublished item, got %d", w.Code)
	}
}

func TestCatalog_GetNonExistentItem_Returns404(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)
	r := chi.NewRouter()
	r.Get("/api/v1/market/items/{itemID}", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items/"+uuid.NewString(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestCatalog_ListChapters(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	itemID := env.SeedItem(t, authorID, uuid.NewString(), 1299)

	env.SeedChapter(t, itemID, 1, 0)
	env.SeedChapter(t, itemID, 2, 199)
	env.SeedChapter(t, itemID, 3, 199)

	h := handlers.NewCatalogHandler(nil, env.DB, env.Log)
	r := chi.NewRouter()
	r.Get("/api/v1/market/items/{itemID}/chapters", h.ListChapters)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items/"+itemID+"/chapters", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Chapters []map[string]any `json:"chapters"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(resp.Chapters) != 3 {
		t.Errorf("expected 3 chapters, got %d", len(resp.Chapters))
	}

	if resp.Chapters[0]["index"].(float64) != 1 {
		t.Errorf("expected first chapter index=1")
	}
}