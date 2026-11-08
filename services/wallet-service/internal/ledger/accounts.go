package ledger

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

// AccountID is a stable identifier for a ledger account.
//
//	AccountID{Type: "author", Key: "abc"}.String() == "author:abc"
type AccountID struct {
	Type string
	Key  string
}

func (a AccountID) String() string {
	return a.Type + ":" + a.Key
}

// AccountBalance represents an account's current balance.
type AccountBalance struct {
	AccountID AccountID
	Currency  string
	// Balance = sum(credit) - sum(debit). Positive means the account
	// holds value; negative means it owes value.
	Balance decimal.Decimal
}

// BalanceFor computes an account's balance in a given currency.
//
// For author accounts, the balance is split semantically:
//   - positive balance = platform owes the author (available to withdraw)
//   - negative balance = author owes the platform (rare; happens after refunds)
//
// For platform accounts (revenue, fees):
//   - positive balance = earned revenue (retained by platform)
//
// For tax:collected:
//   - positive balance = tax owed to authority (must be remitted)
func BalanceFor(
	ctx context.Context,
	pool *pgxpool.Pool,
	account AccountID,
	currency string,
) (*AccountBalance, error) {
	// SELECT COALESCE(SUM(credit - debit), 0)
	// FROM ledger_entries
	// WHERE account_type = $1 AND account_key = $2 AND currency = $3
	var balanceStr string
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(credit - debit), 0)::text
		FROM ledger_entries
		WHERE account_type = $1 AND account_key = $2 AND currency = $3
	`, account.Type, account.Key, currency).Scan(&balanceStr)
	if err != nil {
		return nil, fmt.Errorf("query balance: %w", err)
	}

	balance, err := decimal.NewFromString(balanceStr)
	if err != nil {
		return nil, fmt.Errorf("parse balance: %w", err)
	}

	return &AccountBalance{
		AccountID: account,
		Currency:  currency,
		Balance:   balance,
	}, nil
}

// AuthorBalances returns the "available" and "pending" balances for an
// author. In v1 both are derived from the same ledger — pending is
// tracked via metadata in transactions (or, in v2, via a sub-account
// `author:{id}:pending`).
//
// For now:
//   - available = full balance (all earnings immediately withdrawable
//     after the payout delay)
//   - pending = 0 (v2 will add pending)
func AuthorBalances(
	ctx context.Context,
	pool *pgxpool.Pool,
	authorID string,
	currency string,
) (available, pending decimal.Decimal, err error) {
	bal, err := BalanceFor(ctx, pool, AccountID{Type: "author", Key: authorID}, currency)
	if err != nil {
		return decimal.Zero, decimal.Zero, err
	}
	return bal.Balance, decimal.Zero, nil
}

// TotalAuthorEarnings sums all gross author earnings (for analytics).
// Different from balance: this counts revenue that has ever been credited,
// not what's currently withdrawable.
func TotalAuthorEarnings(
	ctx context.Context,
	pool *pgxpool.Pool,
	authorID string,
	currency string,
) (decimal.Decimal, error) {
	var sumStr string
	err := pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(credit), 0)::text
		FROM ledger_entries
		WHERE account_type = 'author' AND account_key = $1 AND currency = $2
	`, authorID, currency).Scan(&sumStr)
	if err != nil {
		return decimal.Zero, fmt.Errorf("sum earnings: %w", err)
	}
	return decimal.NewFromString(sumStr)
}