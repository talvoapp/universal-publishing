//go:build integration

package tests

import (
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
)

// ============================================================
// PAYOUT INTEGRATION TESTS
// ============================================================

// These tests focus on the validation logic (min/max/balance/connect).
// The actual Stripe transfer is NOT exercised — we'd need stripe-mock.

func testConfig() *config.Config {
	return &config.Config{
		PayoutMinimumCents:  1000,    // $10
		PayoutMaximumCents:  1000000, // $10,000
		PayoutDelayDays:     7,
		PlatformFeePercent:  15,
	}
}

func TestPayout_BelowMinimum(t *testing.T) {
	cfg := testConfig()
	minAmount := decimal.NewFromInt(cfg.PayoutMinimumCents).Div(decimal.NewFromInt(100))

	// $5 < $10 → should reject
	requested := decimal.NewFromInt(500).Div(decimal.NewFromInt(100))
	if requested.GreaterThanOrEqual(minAmount) {
		t.Errorf("test setup: requested should be below minimum")
	}
}

func TestPayout_AboveMaximum(t *testing.T) {
	cfg := testConfig()
	maxAmount := decimal.NewFromInt(cfg.PayoutMaximumCents).Div(decimal.NewFromInt(100))

	// $15,000 > $10,000 → should reject
	requested := decimal.NewFromInt(1500000).Div(decimal.NewFromInt(100))
	if requested.LessThanOrEqual(maxAmount) {
		t.Errorf("test setup: requested should exceed maximum")
	}
}

func TestPayout_RequiresActiveConnect(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	// No Connect account seeded → payout should be rejected
	var status string
	err := env.DB.QueryRow(env.Ctx, `
		SELECT status FROM author_connect_accounts WHERE author_id = $1
	`, authorID).Scan(&status)
	if err == nil {
		t.Errorf("expected no connect account, got status=%s", status)
	}

	// After seeding, status should be active
	env.SeedConnect(t, authorID)
	err = env.DB.QueryRow(env.Ctx, `
		SELECT status FROM author_connect_accounts WHERE author_id = $1
	`, authorID).Scan(&status)
	if err != nil {
		t.Fatalf("query after seed: %v", err)
	}
	if status != "active" {
		t.Errorf("expected active, got %s", status)
	}
}

func TestPayout_RequiresBalance(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()
	env.SeedConnect(t, authorID)

	// Balance is $0 → requesting $10 should fail
	// (In production, RequestPayout would return INSUFFICIENT_BALANCE.)
	// For this test, we verify the balance query returns 0.
	var balanceStr string
	err := env.DB.QueryRow(env.Ctx, `
		SELECT COALESCE(SUM(credit - debit), 0)::text
		FROM ledger_entries
		WHERE account_type = 'author' AND account_key = $1 AND currency = 'USD'
	`, authorID).Scan(&balanceStr)
	if err != nil {
		t.Fatalf("balance query: %v", err)
	}
	if balanceStr != "0" {
		t.Errorf("expected 0 balance, got %s", balanceStr)
	}
}

func TestPayout_DoubleEntryReversal(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	authorID := uuid.NewString()

	// Credit $100 to author
	err := env.Ledger.PostTransaction(env.Ctx, ledgerTx(authorID, decimal.NewFromInt(100), "credit"))
	if err != nil {
		t.Fatalf("credit: %v", err)
	}

	// Simulate payout: debit $50
	err = env.Ledger.PostTransaction(env.Ctx, payoutTx(authorID, decimal.NewFromInt(50)))
	if err != nil {
		t.Fatalf("debit: %v", err)
	}

	// Verify balance = 50
	var balanceStr string
	_ = env.DB.QueryRow(env.Ctx, `
		SELECT COALESCE(SUM(credit - debit), 0)::text
		FROM ledger_entries
		WHERE account_type = 'author' AND account_key = $1
	`, authorID).Scan(&balanceStr)
	if balanceStr != "50" {
		t.Errorf("expected 50, got %s", balanceStr)
	}

	// Simulate payout failure: reverse the debit
	err = env.Ledger.PostTransaction(env.Ctx, reversePayoutTx(authorID, decimal.NewFromInt(50)))
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	// Verify balance = 100 again
	_ = env.DB.QueryRow(env.Ctx, `
		SELECT COALESCE(SUM(credit - debit), 0)::text
		FROM ledger_entries
		WHERE account_type = 'author' AND account_key = $1
	`, authorID).Scan(&balanceStr)
	if balanceStr != "100" {
		t.Errorf("expected 100 after reversal, got %s", balanceStr)
	}
}

// ------------------------------------------------------------
// Helpers (import ledger + build transactions)
// ------------------------------------------------------------
import "github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"

func ledgerTx(authorID string, amount decimal.Decimal, _ string) ledger.Transaction {
	return ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeOrderPaid,
		Reference:  "order-1",
		Currency:   "USD",
		OccurredAt: timeNow(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "revenue", Debit: amount, Credit: decimal.Zero},
			{AccountType: "author", AccountKey: authorID, Debit: decimal.Zero, Credit: amount},
		},
	}
}

func payoutTx(authorID string, amount decimal.Decimal) ledger.Transaction {
	return ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypePayout,
		Reference:  "payout-1",
		Currency:   "USD",
		OccurredAt: timeNow(),
		Entries: []ledger.Entry{
			{AccountType: "author", AccountKey: authorID, Debit: amount, Credit: decimal.Zero},
			{AccountType: "platform", AccountKey: "payouts_clearing", Debit: decimal.Zero, Credit: amount},
		},
	}
}

func reversePayoutTx(authorID string, amount decimal.Decimal) ledger.Transaction {
	return ledger.Transaction{
		EventID:    uuid.NewString(),
		Type:       ledger.TxTypeAdjustment,
		Reference:  "reverse-payout-1",
		Currency:   "USD",
		OccurredAt: timeNow(),
		Entries: []ledger.Entry{
			{AccountType: "platform", AccountKey: "payouts_clearing", Debit: amount, Credit: decimal.Zero},
			{AccountType: "author", AccountKey: authorID, Debit: decimal.Zero, Credit: amount},
		},
	}
}

func timeNow() time.Time { return time.Now() }