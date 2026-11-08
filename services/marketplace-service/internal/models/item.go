package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// ItemType distinguishes sellable products.
type ItemType string

const (
	ItemTypeBook    ItemType = "book"
	ItemTypeArticle ItemType = "article"
	ItemTypeNews    ItemType = "news_channel"
)

// PricingModel describes how an item is sold.
type PricingModel string

const (
	PricingPayPerBook    PricingModel = "pay_per_book"
	PricingPayPerChapter PricingModel = "pay_per_chapter"
	PricingSubscription  PricingModel = "subscription"
)

// Item represents a sellable product in the marketplace.
//
// Note: the actual content (draft) lives in editor-service's MongoDB.
// This table holds only the marketplace-facing metadata + pricing.
type Item struct {
	ID          uuid.UUID `json:"id"`
	DraftID     uuid.UUID `json:"draftId"` // links to editor-service
	AuthorID    uuid.UUID `json:"authorId"`

	Type         ItemType     `json:"type"`
	PricingModel PricingModel `json:"pricingModel"`
	Title        string       `json:"title"`
	Description  string       `json:"description,omitempty"`
	CoverURL     string       `json:"coverUrl,omitempty"`
	Language     string       `json:"language"`
	Tags         []string     `json:"tags,omitempty"`

	// Base price for pay_per_book; for subscription, this is the monthly price.
	PriceCents int64  `json:"priceCents"`
	Currency   string `json:"currency"`

	// Free preview chapters (integers, 1-indexed).
	FreeChapters []int `json:"freeChapters,omitempty"`

	// If true, item is visible in the catalog. Authors can unpublish.
	IsPublished bool `json:"isPublished"`

	// Denormalized counts for fast catalog rendering.
	WordCount int `json:"wordCount,omitempty"`
	ReadMinutes int `json:"readMinutes,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PriceFor returns the price for the given chapter (if pay_per_chapter) or
// the base price (if pay_per_book).
//
// Returns `(price, true)` if the chapter is paid, `(0, false)` if it's free.
func (i *Item) PriceFor(chapter *Chapter) (decimal.Decimal, bool) {
	if i.PricingModel == PricingPayPerBook {
		return decimal.NewFromInt(i.PriceCents).Div(decimal.NewFromInt(100)), true
	}
	if chapter == nil {
		return decimal.Zero, false
	}
	for _, free := range i.FreeChapters {
		if free == chapter.Index {
			return decimal.Zero, false
		}
	}
	return decimal.NewFromInt(chapter.PriceCents).Div(decimal.NewFromInt(100)), true
}