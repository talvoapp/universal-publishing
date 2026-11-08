package ledger

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// ErrDuplicateEvent is returned when a transaction's EventID has already
// been posted. Callers (the Kafka consumer) should treat this as success
// — it means the event was already handled.
var ErrDuplicateEvent = errors.New("ledger: duplicate event (already processed)")

// Service manages ledger transactions.
type Service struct {
	db  *pgxpool.Pool
	log *zap.Logger
}

// NewService creates a ledger service.
func NewService(db *pgxpool.Pool, log *zap.Logger) *Service {
	return &Service{db: db, log: log}
}

// PostTransaction validates and atomically posts a transaction.
//
// Atomicity: this happens in a single DB transaction:
//  1. INSERT transaction row
//  2. INSERT N entry rows (debit and credit lines)
//  3. INSERT processed_event row (idempotency marker)
//
// If any step fails, all are rolled back. If the processed_event insert
// hits a unique constraint (event already processed), the whole tx
// rolls back and ErrDuplicateEvent is returned.
//
// Concurrency: the unique constraint on `processed_events.event_id`
// guarantees that two concurrent consumers cannot both succeed. The
// second one gets ErrDuplicateEvent.
func (s *Service) PostTransaction(ctx context.Context, tx Transaction) error {
	// Validate BEFORE opening a DB transaction (fail fast, avoid holding
	// locks on invalid input).
	if err := tx.Validate(); err != nil {
		return fmt.Errorf("validate: %w", err)
	}

	return pgxTx(ctx, s.db, func(dbTx pgx.Tx) error {
		// 1. Insert transaction
		txID := uuid.NewString()
		_, err := dbTx.Exec(ctx, `
			INSERT INTO ledger_transactions (
				id, event_id, type, reference, currency, occurred_at, metadata, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
		`,
			txID,
			tx.EventID,
			string(tx.Type),
			tx.Reference,
			tx.Currency,
			tx.OccurredAt,
			tx.Metadata,
		)
		if err != nil {
			// Defensive — should have been caught by processed_events insert
			// below, but log just in case a schema invariant is broken.
			if isUniqueViolation(err, "ledger_transactions_event_id_key") {
				return ErrDuplicateEvent
			}
			return fmt.Errorf("insert transaction: %w", err)
		}

		// 2. Insert entries (bulk insert)
		if err := insertEntries(ctx, dbTx, txID, tx); err != nil {
			return fmt.Errorf("insert entries: %w", err)
		}

		// 3. Mark event as processed (idempotency barrier)
		_, err = dbTx.Exec(ctx, `
			INSERT INTO processed_events (event_id, event_type, transaction_id, processed_at)
			VALUES ($1, $2, $3, now())
		`, tx.EventID, string(tx.Type), txID)
		if err != nil {
			// If the event was already processed, the whole tx rolls back
			// and we surface the special error.
			if isUniqueViolation(err, "") {
				return ErrDuplicateEvent
			}
			return fmt.Errorf("insert processed_event: %w", err)
		}

		return nil
	})
}

// insertEntries bulk-inserts all entry rows for a transaction.
func insertEntries(ctx context.Context, tx pgx.Tx, txID string, t Transaction) error {
	// Use pgx.Batch for efficiency (one round-trip).
	batch := &pgx.Batch{}
	for _, e := range t.Entries {
		batch.Queue(`
			INSERT INTO ledger_entries (
				id, transaction_id, account_type, account_key,
				debit, credit, currency, created_at
			) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, now())
		`,
			txID,
			e.AccountType,
			e.AccountKey,
			e.Debit,
			e.Credit,
			t.Currency,
		)
	}

	results := tx.SendBatch(ctx, batch)
	defer results.Close()

	for i := 0; i < batch.Len(); i++ {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("batch entry %d: %w", i, err)
		}
	}
	return nil
}

// pgxTx is a small helper that wraps a callback in a transaction.
// Rolls back on error or panic.
func pgxTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	dbTx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = dbTx.Rollback(ctx) }()

	if err := fn(dbTx); err != nil {
		return err
	}
	if err := dbTx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// isUniqueViolation returns true if err is a Postgres unique constraint
// violation. If constraintName is non-empty, verifies the specific constraint.
func isUniqueViolation(err error, constraintName string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	if pgErr.Code != "23505" { // unique_violation
		return false
	}
	if constraintName != "" && pgErr.ConstraintName != constraintName {
		return false
	}
	return true
}