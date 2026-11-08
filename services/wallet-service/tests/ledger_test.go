//go:build integration

package tests

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
)

// ============================================================
// LEDGER INTEGRATION TESTS
// ============================================================

func TestLedger_PostBalancedTransaction(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	tx := ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-123",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Metadata:   map[string]any{"test": true},
		Entries: []ledger.Entry{
			{
				AccountType: "platform",
				AccountKey:  "revenue",
				Debit:       decimal.NewFromInt(1000).Div(decimal.NewFromInt(100)),
				Credit:      decimal.Zero,
			},
			{
				AccountType: "author",
				AccountKey:  authorID,
				Debit:       decimal.Zero,
				Credit:      decimal.NewFromInt(1000).Div(decimal.NewFromInt(100)),
			},
		},
	}

	err := env.Ledger.PostTransaction(env.Ctx, tx)
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	// Verify balance
	bal, err := ledger.BalanceFor(env.Ctx, env.DB,
		ledger.AccountID{Type: "author", Key: authorID}, "USD")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	expected := decimal.NewFromInt(10)
	if !bal.Balance.Equal(expected) {
		t.Errorf("expected balance 10, got %s", bal.Balance.String())
	}
}

func TestLedger_RejectsUnbalanced(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	tx := ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.NewFromInt(100), Credit: decimal.Zero},
			{AccountType: "author", AccountKey: "abc", Debit: decimal.Zero, Credit: decimal.NewFromInt(50)}, // mismatch!
		},
	}

	err := env.Ledger.PostTransaction(env.Ctx, tx)
	if err == nil {
		t.Fatalf("expected error for unbalanced tx")
	}
	// Should not have persisted anything
	var count int
	_ = env.DB.QueryRow(env.Ctx, `SELECT count(*) FROM ledger_transactions`).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 transactions, got %d", count)
	}
}

func TestLedger_RejectsZeroEntry(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	tx := ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.Zero, Credit: decimal.Zero}, // zero
			{AccountType: "author", AccountKey: "abc", Debit: decimal.NewFromInt(10), Credit: decimal.Zero},
		},
	}

	err := env.Ledger.PostTransaction(env.Ctx, tx)
	if err == nil {
		t.Fatalf("expected error for zero entry")
	}
}

func TestLedger_Idempotency(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	eventID := uuid.NewString()

	tx := ledger.Transaction{
		EventID:    eventID,
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.NewFromInt(10), Credit: decimal.Zero},
			{AccountType: "author", AccountKey: authorID, Debit: decimal.Zero, Credit: decimal.NewFromInt(10)},
		},
	}

	// First post: succeeds
	if err := env.Ledger.PostTransaction(env.Ctx, tx); err != nil {
		t.Fatalf("first post: %v", err)
	}

	// Second post (same event_id): should return ErrDuplicateEvent
	err := env.Ledger.PostTransaction(env.Ctx, tx)
	if err != ledger.ErrDuplicateEvent {
		t.Fatalf("expected ErrDuplicateEvent, got %v", err)
	}

	// Only 1 transaction should exist
	var count int
	_ = env.DB.QueryRow(env.Ctx, `SELECT count(*) FROM ledger_transactions`).Scan(&count)
	if count != 1 {
		t.Errorf("expected 1 transaction, got %d", count)
	}

	// Balance should be 10, not 20 (idempotent)
	bal, _ := ledger.BalanceFor(env.Ctx, env.DB,
		ledger.AccountID{Type: "author", Key: authorID}, "USD")
	if !bal.Balance.Equal(decimal.NewFromInt(10)) {
		t.Errorf("expected balance 10, got %s", bal.Balance.String())
	}
}

func TestLedger_BalanceAfterRefund(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	// Credit $100
	err := env.Ledger.PostTransaction(env.Ctx, ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.NewFromInt(100), Credit: decimal.Zero},
			{AccountType: "author", AccountKey: authorID, Debit: decimal.Zero, Credit: decimal.NewFromInt(100)},
		},
	})
	if err != nil {
		t.Fatalf("credit: %v", err)
	}

	// Debit $30 (partial refund)
	err = env.Ledger.PostTransaction(env.Ctx, ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeRefundIssued,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "author", AccountKey: authorID, Debit: decimal.NewFromInt(30), Credit: decimal.Zero},
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.Zero, Credit: decimal.NewFromInt(30)},
		},
	})
	if err != nil {
		t.Fatalf("debit: %v", err)
	}

	bal, _ := ledger.BalanceFor(env.Ctx, env.DB,
		ledger.AccountID{Type: "author", Key: authorID}, "USD")

	expected := decimal.NewFromInt(70)
	if !bal.Balance.Equal(expected) {
		t.Errorf("expected balance 70, got %s", bal.Balance.String())
	}
}

func TestLedger_Validation(t *testing.T) {
	// Unit test — no DB required
	validTx := ledger.Transaction{
		EventID:    "evt-1",
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: time.Now(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: decimal.NewFromInt(10), Credit: decimal.Zero},
			{AccountType: "author", AccountKey: "abc", Debit: decimal.Zero, Credit: decimal.NewFromInt(10)},
		},
	}

	if err := validTx.Validate(); err != nil {
		t.Errorf("valid tx rejected: %v", err)
	}

	// Missing event id
	badTx := validTx
	badTx.EventID = ""
	if err := badTx.Validate(); err == nil {
		t.Errorf("expected error for missing event id")
	}

	// Negative amount
	badTx2 := validTx
	badTx2.Entries = []ledger.Entry{
		{AccountType: "platform", AccountKey: "revenue", Debit: decimal.NewFromInt(-10), Credit: decimal.Zero},
		{AccountType: "author", AccountKey: "abc", Debit: decimal.Zero, Credit: decimal.NewFromInt(-10)},
	}
	if err := badTx2.Validate(); err == nil {
		t.Errorf("expected error for negative amounts")
	}

	// Bad account type
	badTx3 := validTx
	badTx3.Entries[0].AccountType = "unknown"
	if err := badTx3.Validate(); err == nil {
		t.Errorf("expected error for unknown account type")
	}
}

// silence unused imports
var _ = context.Background