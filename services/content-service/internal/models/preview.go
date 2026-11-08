package models

import (
	"time"
)

// ArticleSummary is the metadata-only projection for lists/headers.
type ArticleSummary struct {
	ItemID       string         `json:"itemId"`
	Title        string         `json:"title"`
	ContentType  string         `json:"contentType"`
	Language     string         `json:"language"`
	WordCount    int            `json:"wordCount"`
	ReadMinutes  int            `json:"readMinutes"`
	CoverImageURL string        `json:"coverImageUrl,omitempty"`
	Tags         []string       `json:"tags,omitempty"`
	PublishedAt  *time.Time     `json:"publishedAt,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// ChapterSummary is the metadata-only projection for a chapter.
type ChapterSummary struct {
	ChapterID string `json:"chapterId"`
	Index     int    `json:"index"`
	Title     string `json:"title"`
	WordCount int    `json:"wordCount"`
	// Free indicates whether this chapter can be read without purchase
	// (mirrors the marketplace item's `free_chapters` list).
	Free      bool   `json:"free"`
}

// Preview is the response for a free preview endpoint.
//
// It contains:
//   - Metadata (title, cover, word count)
//   - A TRUNCATED excerpt of the content (first PREVIEW_FRACTION of it)
//   - A `truncated` flag to make the client aware
//   - A `purchaseUrl` so the client can show a call-to-action
type Preview struct {
	ArticleSummary
	Excerpt         string `json:"excerpt"`
	Truncated       bool   `json:"truncated"`
	PreviewFraction float64 `json:"previewFraction"`
	PurchaseURL     string `json:"purchaseUrl,omitempty"`
}

// ChapterPreview is the preview for a specific chapter.
type ChapterPreview struct {
	ItemID        string    `json:"itemId"`
	ChapterID     string    `json:"chapterId"`
	ChapterIndex  int       `json:"chapterIndex"`
	ChapterTitle  string    `json:"chapterTitle"`
	Excerpt       string    `json:"excerpt"`
	Truncated     bool      `json:"truncated"`
	PreviewFraction float64 `json:"previewFraction"`
	PurchaseURL   string    `json:"purchaseUrl,omitempty"`
}

// FullContent is the response for a gated `/read` endpoint.
//
// Only returned when the EntitlementMiddleware has confirmed access.
type FullContent struct {
	ItemID       string     `json:"itemId"`
	Title        string     `json:"title"`
	ContentType  string     `json:"contentType"`
	Language     string     `json:"language"`
	Content      string     `json:"content"`
	WordCount    int        `json:"wordCount"`
	ReadMinutes  int        `json:"readMinutes"`
	PublishedAt  *time.Time `json:"publishedAt,omitempty"`
	EntitlementType string  `json:"entitlementType"` // "purchase" | "subscription" | "owner" | "admin"
}

// FullChapter is the response for a gated chapter read.
type FullChapter struct {
	ItemID       string     `json:"itemId"`
	ChapterID    string     `json:"chapterId"`
	ChapterIndex int        `json:"chapterIndex"`
	ChapterTitle string     `json:"chapterTitle"`
	Content      string     `json:"content"`
	WordCount    int        `json:"wordCount"`
	EntitlementType string  `json:"entitlementType"`
}