package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// SubscriptionStatus is the lifecycle state of a subscription.
type SubscriptionStatus string

const (
	SubActive    SubscriptionStatus = "active"
	SubPastDue   SubscriptionStatus = "past_due"
	SubCanceled  SubscriptionStatus = "canceled"
	SubIncomplete SubscriptionStatus = "incomplete"
	SubTrialing  SubscriptionStatus = "trialing"
)

// Subscription represents a recurring purchase (news channel, author, etc.).
type Subscription struct {
	ID          uuid.UUID `json:"id"`
	BuyerID     uuid.UUID `json:"buyerId"`
	TargetID    uuid.UUID `json:"targetId"`     // author or news channel
	TargetType  string    `json:"targetType"`   // "author" | "news_channel"
	TierID      uuid.UUID `json:"tierId"`

	StripeSubscriptionID string `json:"stripeSubscriptionId"`
	StripeCustomerID     string `json:"stripeCustomerId"`

	Status   SubscriptionStatus `json:"status"`
	Currency string             `json:"currency"`
	Amount   decimal.Decimal    `json:"amount"` // per period

	CurrentPeriodStart time.Time  `json:"currentPeriodStart"`
	CurrentPeriodEnd   time.Time  `json:"currentPeriodEnd"`
	CancelAtPeriodEnd  bool       `json:"cancelAtPeriodEnd"`
	CanceledAt         *time.Time `json:"canceledAt,omitempty"`
	TrialEnd           *time.Time `json:"trialEnd,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}