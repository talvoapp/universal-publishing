package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// PayoutStatus is the lifecycle state of a payout.
type PayoutStatus string

const (
	PayoutPending    PayoutStatus = "pending"     // requested, awaiting Connect status
	PayoutProcessing PayoutStatus = "processing"  // sent to Stripe, awaiting confirmation
	PayoutCompleted  PayoutStatus = "completed"   // paid
	PayoutFailed     PayoutStatus = "failed"      // Stripe rejected
	PayoutCancelled  PayoutStatus = "cancelled"   // user or admin cancelled before send
)

// Payout represents a request to withdraw author balance to a bank account
// (via Stripe Connect).
type Payout struct {
	ID       uuid.UUID `json:"id"`
	AuthorID uuid.UUID `json:"authorId"`

	Amount   decimal.Decimal `json:"amount"`
	Currency string          `json:"currency"`

	// Stripe references
	StripeTransferID string `json:"stripeTransferId,omitempty"`
	StripePayoutID   string `json:"stripePayoutId,omitempty"`

	Status PayoutStatus `json:"status"`
	Reason string       `json:"reason,omitempty"` // failure reason

	// Ledger transaction that debited the author's balance
	LedgerTransactionID *uuid.UUID `json:"ledgerTransactionId,omitempty"`

	RequestedAt time.Time  `json:"requestedAt"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	FailedAt    *time.Time `json:"failedAt,omitempty"`

	RequestedBy uuid.UUID `json:"requestedBy"` // user who requested it
	AdminNotes  string    `json:"adminNotes,omitempty"`
}