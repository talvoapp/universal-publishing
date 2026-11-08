// Package models defines DB row structs + domain shapes for wallet.
package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Wallet is a read-only view of an author's balance + activity summary.
// It is NOT a stored table — it's computed from ledger_entries on demand.
type Wallet struct {
	AuthorID  uuid.UUID       `json:"authorId"`
	Currency  string          `json:"currency"`
	Available decimal.Decimal `json:"available"`
	Pending   decimal.Decimal `json:"pending"`
	Lifetime  decimal.Decimal `json:"lifetime"`     // gross earnings ever
	PaidOut   decimal.Decimal `json:"paidOut"`      // sum of completed payouts
	UpdatedAt time.Time       `json:"updatedAt"`
}