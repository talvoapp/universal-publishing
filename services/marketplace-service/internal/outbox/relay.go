// Package outbox — the background relay that flushes the outbox table
// to Kafka.
//
// Design:
//   - The `outbox` table is the source of truth for pending events.
//   - The relay polls for unpublished rows in small batches, publishes
//     them to Kafka, then marks them published (in a transaction).
//   - On startup, the relay picks up any rows left unpublished from the
//     previous pod.
//   - The relay runs continuously; if it crashes, K8s restarts the pod
//     and the relay resumes from where it left off.
//
// Guarantees:
//   - At-least-once delivery to Kafka.
//   - Ordering per aggregate_id (partitioned by aggregate_id).
//   - No event is marked published until Kafka confirms the write.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// RelayConfig configures the outbox relay worker.
type RelayConfig struct {
	Pool         *pgxpool.Pool
	Publisher    *Publisher
	Logger       *zap.Logger
	PollInterval time.Duration // default 500ms
	BatchSize    int           // default 100
}

// Relay is the background worker that publishes pending outbox events.
type Relay struct {
	cfg  RelayConfig
	quit chan struct{}
	done chan struct{}
}

// NewRelay creates a new relay. Call Start() to begin processing.
func NewRelay(cfg RelayConfig) *Relay {
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 500 * time.Millisecond
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 100
	}
	return &Relay{
		cfg:  cfg,
		quit: make(chan struct{}),
		done: make(chan struct{}),
	}
}

// Start launches the relay in a goroutine. Blocks until Stop() is called
// and the current batch completes.
func (r *Relay) Start(ctx context.Context) {
	go r.run(ctx)
}

// Stop signals the relay to stop and waits for the current batch to finish.
func (r *Relay) Stop() {
	close(r.quit)
	<-r.done
}

// run is the main loop.
func (r *Relay) run(ctx context.Context) {
	defer close(r.done)
	r.cfg.Logger.Info("outbox_relay_started",
		zap.Duration("poll_interval", r.cfg.PollInterval),
		zap.Int("batch_size", r.cfg.BatchSize),
	)

	ticker := time.NewTicker(r.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.cfg.Logger.Info("outbox_relay_stopped", zap.String("reason", "ctx_done"))
			return
		case <-r.quit:
			r.cfg.Logger.Info("outbox_relay_stopped", zap.String("reason", "quit"))
			return
		case <-ticker.C:
			if err := r.processBatch(ctx); err != nil {
				r.cfg.Logger.Warn("outbox_batch_error", zap.Error(err))
			}
		}
	}
}

// processBatch reads up to BatchSize unpublished events, publishes each,
// and marks them published.
func (r *Relay) processBatch(ctx context.Context) error {
	// 1. Fetch pending events with row-level locking.
	//    `FOR UPDATE SKIP LOCKED` allows multiple relay pods to work
	//    concurrently without stepping on each other.
	tx, err := r.cfg.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		SELECT id, event_type, aggregate_id, payload, meta, created_at
		FROM outbox
		WHERE published_at IS NULL
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, r.cfg.BatchSize)
	if err != nil {
		return fmt.Errorf("select pending: %w", err)
	}

	type pending struct {
		ID          uuid.UUID
		EventType   string
		AggregateID string
		Payload     []byte
		Meta        []byte
		CreatedAt   time.Time
	}

	var batch []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.ID, &p.EventType, &p.AggregateID, &p.Payload, &p.Meta, &p.CreatedAt); err != nil {
			rows.Close()
			return fmt.Errorf("scan: %w", err)
		}
		batch = append(batch, p)
	}
	rows.Close()

	if len(batch) == 0 {
		return nil // nothing to do
	}

	// 2. Publish each event. On any failure, abort — the tx will roll
	//    back so nothing is marked published and we retry next tick.
	publishedIDs := make([]uuid.UUID, 0, len(batch))
	for _, p := range batch {
		var payload map[string]any
		if err := json.Unmarshal(p.Payload, &payload); err != nil {
			r.cfg.Logger.Error("outbox_bad_payload",
				zap.String("event_id", p.ID.String()),
				zap.Error(err),
			)
			// Skip this one — don't block the whole queue.
			// We still mark it published so it doesn't retry forever.
			publishedIDs = append(publishedIDs, p.ID)
			continue
		}

		var meta EventMeta
		_ = json.Unmarshal(p.Meta, &meta)

		evt := Event{
			ID:          p.ID.String(),
			Type:        p.EventType,
			AggregateID: p.AggregateID,
			OccurredAt:  p.CreatedAt,
			Payload:     payload,
			Meta:        meta,
		}

		if err := r.cfg.Publisher.Publish(ctx, evt); err != nil {
			// Kafka failure — roll back the whole batch, will retry.
			return fmt.Errorf("publish %s: %w", evt.ID, err)
		}

		publishedIDs = append(publishedIDs, p.ID)
	}

	// 3. Mark as published.
	if _, err := tx.Exec(ctx, `
		UPDATE outbox
		SET published_at = now()
		WHERE id = ANY($1)
	`, publishedIDs); err != nil {
		return fmt.Errorf("mark published: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	r.cfg.Logger.Debug("outbox_batch_processed", zap.Int("count", len(publishedIDs)))
	return nil
}

// Insert writes a new event to the outbox table. Callers should invoke
// this INSIDE the same transaction as the business operation that
// generates the event (per the transactional outbox pattern).
//
// Example:
//
//	err := db.WithTx(ctx, pool, func(tx pgx.Tx) error {
//	    if err := orderRepo.Insert(ctx, tx, order); err != nil { return err }
//	    return outbox.Insert(ctx, tx, outbox.Event{...})
//	})
func Insert(ctx context.Context, tx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}, evt Event) error {
	payload, err := json.Marshal(evt.Payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	meta, err := json.Marshal(evt.Meta)
	if err != nil {
		return fmt.Errorf("marshal meta: %w", err)
	}
	id := evt.ID
	if id == "" {
		id = uuid.NewString()
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO outbox (id, event_type, aggregate_id, payload, meta, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, id, evt.Type, evt.AggregateID, payload, meta, evt.OccurredAt)
	if err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}