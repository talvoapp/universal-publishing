// Package handlers — preview endpoints (public, no entitlement needed).
//
// Previews are the free sample that any authenticated user can see.
// They contain:
//   - Metadata (title, cover, tags)
//   - A TRUNCATED excerpt (first PREVIEW_FRACTION of the content)
//   - A purchase URL so the frontend can show a CTA
//
// Preview responses are cacheable by CDN (60s) because they are
// identical for all users (no entitlement check involved).
package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// GetPreview returns a truncated excerpt of an item.
//
//	GET /api/v1/content/{itemID}/preview
//
// Public route — no entitlement middleware.
// Response includes `truncated: true` and `purchaseUrl`.
func (h *ContentHandler) GetPreview(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	if itemID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID", "MISSING_ITEM_ID"))
		return
	}

	article, err := h.content.GetArticle(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	preview := h.content.BuildPreview(article)

	// Preview is public-safe: identical for all users → CDN-cacheable.
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, preview)
}

// GetChapterPreview returns a truncated excerpt of a specific chapter.
//
//	GET /api/v1/content/{itemID}/chapters/{chapterID}/preview
//
// Public route — no entitlement middleware.
func (h *ContentHandler) GetChapterPreview(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	chapterID := chi.URLParam(r, "chapterID")
	if itemID == "" || chapterID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID or chapterID", "MISSING_PARAM"))
		return
	}

	chapterIndex, err := strconv.Atoi(chapterID)
	if err != nil || chapterIndex < 1 {
		writeError(w, r, utils.BadRequest("Invalid chapterID", "INVALID_CHAPTER_ID"))
		return
	}

	article, chapter, err := h.content.GetChapter(r.Context(), itemID, chapterIndex)
	if err != nil {
		writeError(w, r, err)
		return
	}

	preview := h.content.BuildChapterPreview(article, chapter, chapterID)

	// Public-safe (truncated) → CDN-cacheable.
	w.Header().Set("Cache-Control", "public, max-age=60")
	writeJSON(w, http.StatusOK, preview)
}