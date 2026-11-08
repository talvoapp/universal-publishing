package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// LedgerTransaction represents a single double-entry transaction row.
type LedgerTransaction struct {
	ID         uuid.UUID       `json:"id"`
	EventID    string          `json:"eventId"`
	Type       string          `json:"type"`
	Reference  string          `json:"reference"`
	Currency   string          `json:"currency"`
	OccurredAt time.Time       `json:"occurredAt"`
	Metadata   map[string]any  `json:"metadata,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

// LedgerEntry is a single line of a double-entry transaction.
type LedgerEntry struct {
	ID            uuid.UUID       `json:"id"`
	TransactionID uuid.UUID       `json:"transactionId"`
	AccountType   string          `json:"accountType"` // "author" | "platform" | "tax"
	AccountKey    string          `json:"accountKey"`  // e.g. author UUID, "revenue"
	Debit         decimal.Decimal `json:"debit"`
	Credit        decimal.Decimal `json:"credit"`
	Currency      string          `json:"currency"`
	CreatedAt     time.Time       `json:"createdAt"`
}