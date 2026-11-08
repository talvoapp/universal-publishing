// Package models defines the domain structs + DB row shapes for the
// marketplace service. Fields map 1:1 to columns (snake_case) via
// explicit SQL scanning in the repository layer.
package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// OrderStatus is the lifecycle state of a purchase.
type OrderStatus string

const (
	OrderPending   OrderStatus = "pending"
	OrderSucceeded OrderStatus = "succeeded"
	OrderFailed    OrderStatus = "failed"
	OrderRefunded  OrderStatus = "refunded"
	OrderCancelled OrderStatus = "cancelled"
)

// Order represents a single purchase attempt.
type Order struct {
	ID          uuid.UUID   `json:"id"`
	BuyerID     uuid.UUID   `json:"buyerId"`
	ItemID      uuid.UUID   `json:"itemId"`
	AuthorID    uuid.UUID   `json:"authorId"`
	ChapterIDs  []uuid.UUID `json:"chapterIds,omitempty"` // for pay-per-chapter
	Quantity    int         `json:"quantity"`
	Currency    string      `json:"currency"` // ISO 4217, e.g. "USD"

	// Amounts — use decimal, never float.
	Subtotal        decimal.Decimal `json:"subtotal"`
	TaxAmount       decimal.Decimal `json:"taxAmount"`
	PlatformFee     decimal.Decimal `json:"platformFee"`
	AuthorEarnings  decimal.Decimal `json:"authorEarnings"`
	Total           decimal.Decimal `json:"total"`

	// Stripe references
	StripePaymentIntentID string `json:"stripePaymentIntentId,omitempty"`
	StripeCheckoutID      string `json:"stripeCheckoutId,omitempty"`
	StripeCustomerID      string `json:"stripeCustomerId,omitempty"`

	Status        OrderStatus `json:"status"`
	FailureReason string      `json:"failureReason,omitempty"`

	// Timestamps
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	RefundedAt  *time.Time `json:"refundedAt,omitempty"`

	// Metadata (e.g., tax jurisdiction, purchase context)
	Metadata map[string]any `json:"metadata,omitempty"`
}