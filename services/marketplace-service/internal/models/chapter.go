package models

import (
	"time"

	"github.com/google/uuid"
)

// Chapter represents a single chapter of a book (for pay-per-chapter items).
type Chapter struct {
	ID      uuid.UUID `json:"id"`
	ItemID  uuid.UUID `json:"itemId"`
	Index   int       `json:"index"` // 1-indexed
	Title   string    `json:"title"`

	// Price for this chapter in cents. Ignored for pay_per_book items.
	PriceCents int64 `json:"priceCents"`

	WordCount int `json:"wordCount"`

	// Content snapshot at the time of publication (immutable once published).
	ContentPublished bool `json:"contentPublished"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}