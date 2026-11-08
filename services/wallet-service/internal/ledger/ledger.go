// Package ledger implements a strict double-entry accounting ledger.
//
// Every money movement produces exactly one `Transaction` with N `Entry`
// rows. The invariant enforced at PostTransaction time is:
//
//     sum(entry.debit) == sum(entry.credit)
//
// Each entry is stored as an immutable row. Balances are derived by
// summing entries per account. This is the "event sourcing" model of
// accounting — the entry log is the source of truth, and balances are
// projections that can be rebuilt at any time.
//
// Accounts are identified by (type, key):
//   - ("author",   "<author_id>")          → individual author wallet
//   - ("platform", "revenue")              → gross platform revenue
//   - ("platform", "fees")                 → platform commission
//   - ("tax",      "collected")            → tax held for remittance
//   - ("author",   "<author_id>:pending")  → pending balance (unsettled)
//
// Balances are always in the currency of the transaction. Cross-currency
// transfers are not supported in v1 (each transaction is single-currency).
package ledger

import (
	"fmt"
	"time"

	"github.com/shopspring/decimal"
)

// TxType is the semantic type of a ledger transaction.
type TxType string

const (
	TxTypeOrderPaid    TxType = "OrderPaid"
	TxTypeRefundIssued TxType = "RefundIssued"
	TxTypePayout       TxType = "Payout"
	TxTypeAdjustment   TxType = "Adjustment"
)

// Transaction is a single atomic double-entry posting.
type Transaction struct {
	// EventID is the idempotency key — the ledger refuses to post a
	// transaction whose EventID has already been recorded in
	// `processed_events`.
	EventID string

	// Type is the semantic kind of the transaction.
	Type TxType

	// Reference is the business identifier (order ID, payout ID, etc.).
	Reference string

	// Currency is the ISO-4217 code, e.g. "USD". Same for all entries.
	Currency string

	// OccurredAt is the business timestamp (from the source event, not
	// the processing time).
	OccurredAt time.Time

	// Metadata is arbitrary JSONB stored with the transaction for
	// forensics/debugging.
	Metadata map[string]any

	// Entries are the double-entry lines. Must satisfy:
	//   len(Entries) >= 2
	//   sum(Debit) == sum(Credit)
	//   all currencies match
	Entries []Entry
}

// Entry is a single line of a double-entry transaction.
type Entry struct {
	AccountType string // "author" | "platform" | "tax"
	AccountKey  string // e.g., author UUID, "revenue", "fees", "collected"

	// Debit and Credit are mutually exclusive per entry — one must be
	// zero, the other positive. Never negative.
	Debit  decimal.Decimal
	Credit decimal.Decimal
}

// Validate ensures the transaction is internally consistent.
// Called by PostTransaction BEFORE any DB write.
func (t *Transaction) Validate() error {
	if t.EventID == "" {
		return fmt.Errorf("transaction event_id is required")
	}
	if t.Type == "" {
		return fmt.Errorf("transaction type is required")
	}
	if t.Reference == "" {
		return fmt.Errorf("transaction reference is required")
	}
	if len(t.Currency) != 3 {
		return fmt.Errorf("currency must be a 3-letter ISO-4217 code, got %q", t.Currency)
	}
	if len(t.Entries) < 2 {
		return fmt.Errorf("transaction must have at least 2 entries, got %d", len(t.Entries))
	}

	var totalDebit, totalCredit decimal.Decimal
	for i, e := range t.Entries {
		if e.AccountType == "" || e.AccountKey == "" {
			return fmt.Errorf("entry[%d]: account_type and account_key are required", i)
		}
		if !isValidAccountType(e.AccountType) {
			return fmt.Errorf("entry[%d]: invalid account_type %q", i, e.AccountType)
		}
		if e.Debit.IsNegative() || e.Credit.IsNegative() {
			return fmt.Errorf("entry[%d]: debit/credit must be non-negative", i)
		}
		if e.Debit.IsZero() && e.Credit.IsZero() {
			return fmt.Errorf("entry[%d]: debit and credit are both zero", i)
		}
		if !e.Debit.IsZero() && !e.Credit.IsZero() {
			return fmt.Errorf("entry[%d]: debit and credit are both non-zero (must be one or the other)", i)
		}
		totalDebit = totalDebit.Add(e.Debit)
		totalCredit = totalCredit.Add(e.Credit)
	}

	if !totalDebit.Equal(totalCredit) {
		return fmt.Errorf("unbalanced transaction: debits=%s credits=%s (diff=%s)",
			totalDebit.String(), totalCredit.String(), totalDebit.Sub(totalCredit).String())
	}

	return nil
}

// Total returns the transaction amount (== total debit == total credit).
func (t *Transaction) Total() decimal.Decimal {
	var sum decimal.Decimal
	for _, e := range t.Entries {
		sum = sum.Add(e.Debit)
	}
	return sum
}

// isValidAccountType returns true for known account categories.
func isValidAccountType(t string) bool {
	switch t {
	case "author", "platform", "tax":
		return true
	}
	return false
}