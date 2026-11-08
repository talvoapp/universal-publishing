// Package ledger — double-entry invariants + validation helpers.
//
// FILE ORGANIZATION:
//   - `ledger.go`    — core types (Transaction, Entry, TxType) + Validate
//   - `service.go`   — PostTransaction (DB write) + idempotency
//   - `accounts.go`  — AccountID + balance queries
//   - `double_entry.go` (this file) — additional invariants, assertion
//                       helpers, and utilities used by tests + guards
//
// This file consolidates the *invariants* of double-entry accounting in
// one place, making them easy to audit and reference from tests and
// documentation.
package ledger

import (
	"fmt"

	"github.com/shopspring/decimal"
)

// ============================================================
// INVARIANTS
// ============================================================
//
// A well-formed ledger transaction satisfies ALL of:
//
//   1. Every entry has exactly one non-zero side (debit XOR credit).
//   2. All amounts are >= 0.
//   3. Sum of all debits == Sum of all credits.
//   4. Every transaction has at least 2 entries.
//   5. All entries share the same currency (single-currency tx).
//   6. Every entry has a valid account type.
//   7. Every entry has a non-empty account key.
//
// These are enforced by `Transaction.Validate()` BEFORE any DB write,
// and (for #1, #2) by CHECK constraints in the DB schema.

// DebitTotal returns the sum of all debit entries in a transaction.
func DebitTotal(t Transaction) decimal.Decimal {
	var total decimal.Decimal
	for _, e := range t.Entries {
		total = total.Add(e.Debit)
	}
	return total
}

// CreditTotal returns the sum of all credit entries in a transaction.
func CreditTotal(t Transaction) decimal.Decimal {
	var total decimal.Decimal
	for _, e := range t.Entries {
		total = total.Add(e.Credit)
	}
	return total
}

// IsBalanced returns true if sum(debit) == sum(credit).
// Useful for assertions in tests and as a defensive check.
func IsBalanced(t Transaction) bool {
	return DebitTotal(t).Equal(CreditTotal(t))
}

// AccountTotals summarizes the net effect on a specific account
// within a single transaction.
type AccountTotals struct {
	AccountID AccountID
	Debit     decimal.Decimal // total debited from this account
	Credit    decimal.Decimal // total credited to this account
	Delta     decimal.Decimal // credit - debit (positive = balance grows)
}

// AccountEffect returns the net effect of a transaction on a given account.
// Multiple entries against the same account in one transaction are summed.
func AccountEffect(t Transaction, account AccountID) AccountTotals {
	result := AccountTotals{AccountID: account}
	for _, e := range t.Entries {
		if e.AccountType == account.Type && e.AccountKey == account.Key {
			result.Debit = result.Debit.Add(e.Debit)
			result.Credit = result.Credit.Add(e.Credit)
		}
	}
	result.Delta = result.Credit.Sub(result.Debit)
	return result
}

// ============================================================
// ASSERTION HELPERS (used by tests + runtime guards)
// ============================================================

// AssertBalanced panics if the transaction is unbalanced. Use in tests
// and as a final runtime guard after construction.
func AssertBalanced(t Transaction) {
	if !IsBalanced(t) {
		panic(fmt.Sprintf(
			"unbalanced transaction %s: debits=%s, credits=%s, diff=%s",
			t.Reference,
			DebitTotal(t).String(),
			CreditTotal(t).String(),
			DebitTotal(t).Sub(CreditTotal(t)).String(),
		))
	}
}

// AssertNonNegative panics if any entry has a negative amount.
func AssertNonNegative(t Transaction) {
	for i, e := range t.Entries {
		if e.Debit.IsNegative() || e.Credit.IsNegative() {
			panic(fmt.Sprintf(
				"entry[%d] has negative amount: debit=%s credit=%s",
				i, e.Debit.String(), e.Credit.String(),
			))
		}
	}
}

// AssertInvariants panics if any double-entry invariant is violated.
// Convenience composite — call after constructing any Transaction
// that hasn't gone through Validate() yet.
func AssertInvariants(t Transaction) {
	AssertNonNegative(t)
	AssertBalanced(t)

	if len(t.Entries) < 2 {
		panic(fmt.Sprintf("transaction has only %d entries (min 2)", len(t.Entries)))
	}

	for i, e := range t.Entries {
		if e.Debit.IsZero() == e.Credit.IsZero() {
			panic(fmt.Sprintf(
				"entry[%d]: debit=%s credit=%s (must be XOR: one non-zero, one zero)",
				i, e.Debit.String(), e.Credit.String(),
			))
		}
	}
}

// ============================================================
// WELL-KNOWN ACCOUNT CONSTRUCTORS
// ============================================================
//
// Centralized constructors for the accounts used by wallet-service.
// Using these makes the code self-documenting and prevents typos in
// account keys.

// AuthorAccount returns the AccountID for an author's wallet.
func AuthorAccount(authorID string) AccountID {
	return AccountID{Type: "author", Key: authorID}
}

// PlatformRevenue returns the AccountID for the platform's gross revenue.
func PlatformRevenue() AccountID {
	return AccountID{Type: "platform", Key: "revenue"}
}

// PlatformFees returns the AccountID for the platform's commission.
func PlatformFees() AccountID {
	return AccountID{Type: "platform", Key: "fees"}
}

// PlatformPayoutsClearing returns the AccountID for money in transit
// to authors (between ledger debit and Stripe transfer completion).
func PlatformPayoutsClearing() AccountID {
	return AccountID{Type: "platform", Key: "payouts_clearing"}
}

// TaxCollected returns the AccountID for tax held for remittance.
func TaxCollected() AccountID {
	return AccountID{Type: "tax", Key: "collected"}
}