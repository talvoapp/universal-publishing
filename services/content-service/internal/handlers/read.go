// Package handlers — gated read endpoints (entitlement required).
//
// These handlers are ONLY reached after `EntitlementMiddleware` has
// confirmed access. They MUST include the following response headers
// to prevent caching of paid content:
//
//   Cache-Control: private, no-store, no-cache, must-revalidate
//   Pragma: no-cache
//   X-Robots-Tag: noindex, nofollow
//
// The headers are set here (not in middleware) so that they are
// guaranteed to apply even if a route is misconfigured to bypass the
// middleware.
package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/talvoapp/universal-publishing/content-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// noCacheHeaders applies the mandatory anti-caching headers for paid content.
func noCacheHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "private, no-store, no-cache, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
}

// ReadFullItem returns the full article content (entitlement gated).
//
//	GET /api/v1/content/{itemID}/read
//
// By the time this handler runs, the EntitlementMiddleware has:
//   - Verified the user's JWT (RequireAuth)
//   - Confirmed the user has purchase/subscription/owner/admin access
//   - Populated the EntitlementStatus in context
func (h *ContentHandler) ReadFullItem(w http.ResponseWriter, r *http.Request) {
	itemID := chi.URLParam(r, "itemID")
	if itemID == "" {
		writeError(w, r, utils.BadRequest("Missing itemID", "MISSING_ITEM_ID"))
		return
	}

	// Retrieve entitlement type from context (set by middleware)
	ent := middleware.EntitlementFromContext(r.Context())
	if ent == nil {
		// Defense in depth — should never happen because middleware
		// populates context before this handler runs.
		writeError(w, r, utils.Forbidden("Entitlement check missing", "INTERNAL_ERROR"))
		return
	}

	article, err := h.content.GetArticle(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	full := h.content.BuildFullContent(article, string(ent.Type))

	// CRITICAL: gated content MUST NOT be cached.
	noCacheHeaders(w)

	writeJSON(w, http.StatusOK, full)
}

// ReadChapter returns the full content of a specific chapter (gated).
//
//	GET /api/v1/content/{itemID}/chapters/{chapterID}/read
func (h *ContentHandler) ReadChapter(w http.ResponseWriter, r *http.Request) {
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

	ent := middleware.EntitlementFromContext(r.Context())
	if ent == nil {
		writeError(w, r, utils.Forbidden("Entitlement check missing", "INTERNAL_ERROR"))
		return
	}

	article, chapter, err := h.content.GetChapter(r.Context(), itemID, chapterIndex)
	if err != nil {
		writeError(w, r, err)
		return
	}

	full := h.content.BuildFullChapter(article, chapter, chapterID, string(ent.Type))

	// CRITICAL: gated content MUST NOT be cached.
	noCacheHeaders(w)

	writeJSON(w, http.StatusOK, full)
}