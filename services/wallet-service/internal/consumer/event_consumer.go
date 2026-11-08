// Package consumer implements the Kafka event consumer that drives the
// wallet ledger. Every OrderPaid / RefundIssued event produces exactly
// one immutable ledger transaction.
//
// Design:
//   - Consumer group `wallet-service` (configurable) → multiple replicas
//     share partitions; each partition's events processed by one replica
//     at a time (Kafka guarantees ordering per partition).
//   - Events are keyed by aggregate_id (order ID) in the producer, so all
//     events for a given order land on the same partition → ordering per
//     order is preserved.
//   - Idempotency: before processing, check `processed_events` table.
//     If the event_id is already there, skip. Otherwise, insert the
//     ledger entries AND the processed_event row in the SAME transaction.
//   - On processing failure, do NOT commit the offset → Kafka redelivers.
//   - On success, commit the offset.
package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
)

// Config configures the EventConsumer.
type Config struct {
	Brokers        []string
	Topic          string
	GroupID        string
	ClientID       string
	DB             *pgxpool.Pool
	Redis          *redis.Client
	Stripe         *client.API
	Logger         *zap.Logger
	PlatformFeePct float64
}

// EventConsumer consumes outbox events and mutates the ledger.
type EventConsumer struct {
	cfg     Config
	reader  *kafka.Reader
	log     *zap.Logger
	ledger  *ledger.Service
}

// Event is the envelope of an outbox event.
type Event struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	AggregateID string          `json:"aggregateId"`
	OccurredAt  time.Time       `json:"occurredAt"`
	Payload     json.RawMessage `json:"payload"`
	Meta        struct {
		Service   string `json:"service"`
		Version   string `json:"version"`
		RequestID string `json:"requestId"`
	} `json:"meta"`
}

// NewEventConsumer creates a new consumer.
func NewEventConsumer(cfg Config) *EventConsumer {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		GroupID:        cfg.GroupID,
		Topic:          cfg.Topic,
		MinBytes:       1,
		MaxBytes:       10 * 1024 * 1024, // 10 MB
		MaxWait:        500 * time.Millisecond,
		CommitInterval: 0, // commit manually after successful processing
		StartOffset:    kafka.LastOffset,
		Logger:         &kafkaLogger{log: cfg.Logger},
		ErrorLogger:    &kafkaLogger{log: cfg.Logger},
	})

	return &EventConsumer{
		cfg:    cfg,
		reader: reader,
		log:    cfg.Logger,
		ledger: ledger.NewService(cfg.DB, cfg.Logger),
	}
}

// Run processes messages until ctx is cancelled.
func (c *EventConsumer) Run(ctx context.Context) error {
	c.log.Info("consumer_starting",
		zap.String("group", c.cfg.GroupID),
		zap.String("topic", c.cfg.Topic),
	)

	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil
			}
			c.log.Error("fetch_failed", zap.Error(err))
			// Backoff to avoid tight-looping on broker errors
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(2 * time.Second):
				continue
			}
		}

		if err := c.handleMessage(ctx, msg); err != nil {
			c.log.Error("message_handling_failed",
				zap.Error(err),
				zap.String("offset", fmt.Sprintf("%d", msg.Offset)),
			)
			// Do NOT commit — Kafka redelivers.
			// To prevent infinite tight-looping, briefly sleep.
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(1 * time.Second):
				continue
			}
		}

		// Commit offset AFTER successful handling.
		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			c.log.Error("commit_failed", zap.Error(err))
			// Continue — next commit attempt will re-commit.
		}
	}
}

// Close closes the reader.
func (c *EventConsumer) Close() {
	if c.reader != nil {
		_ = c.reader.Close()
	}
}

// ------------------------------------------------------------
// Message handling
// ------------------------------------------------------------
func (c *EventConsumer) handleMessage(ctx context.Context, msg kafka.Message) error {
	// 1. Parse envelope
	var evt Event
	if err := json.Unmarshal(msg.Value, &evt); err != nil {
		// Malformed JSON — never retry; log and skip.
		c.log.Error("unmarshal_failed", zap.Error(err), zap.String("raw", string(msg.Value[:min(len(msg.Value), 500)])))
		return nil
	}

	if evt.ID == "" || evt.Type == "" || evt.AggregateID == "" {
		c.log.Error("incomplete_event", zap.Any("event", evt))
		return nil
	}

	c.log.Info("event_received",
		zap.String("event_id", evt.ID),
		zap.String("event_type", evt.Type),
		zap.String("aggregate_id", evt.AggregateID),
	)

	// 2. Idempotency check — if already processed, skip.
	if processed, err := c.isProcessed(ctx, evt.ID); err != nil {
		return fmt.Errorf("idempotency check: %w", err)
	} else if processed {
		c.log.Debug("event_already_processed", zap.String("event_id", evt.ID))
		return nil
	}

	// 3. Route by type
	switch evt.Type {
	case "OrderPaid":
		return c.handleOrderPaid(ctx, evt)
	case "RefundIssued":
		return c.handleRefundIssued(ctx, evt)
	default:
		// Ignore unknown types — other services consume them.
		c.log.Debug("event_ignored", zap.String("type", evt.Type))
		return nil
	}
}

// handleOrderPaid credits the author's wallet and records the platform fee.
//
// On OrderPaid:
//   - Debit  platform:revenue_pending  (total)
//   - Credit author:available          (author_earnings)
//   - Credit platform:fees             (platform_fee)
//   - Credit tax:collected             (tax_amount)   [held for remittance]
//
// All entries posted in a single transaction with the processed_event row.
func (c *EventConsumer) handleOrderPaid(ctx context.Context, evt Event) error {
	var payload struct {
		OrderID  string `json:"orderId"`
		BuyerID  string `json:"buyerId"`
		AuthorID string `json:"authorId"`
		Amount   struct {
			Subtotal       string `json:"subtotal"`
			TaxAmount      string `json:"taxAmount"`
			PlatformFee    string `json:"platformFee"`
			AuthorEarnings string `json:"authorEarnings"`
			Total          string `json:"total"`
			Currency       string `json:"currency"`
		} `json:"amount"`
	}

	if err := json.Unmarshal(evt.Payload, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	// Validate
	if payload.OrderID == "" || payload.AuthorID == "" {
		return fmt.Errorf("missing orderId or authorId in payload")
	}
	authorEarnings, err := decimal.NewFromString(payload.Amount.AuthorEarnings)
	if err != nil {
		return fmt.Errorf("parse authorEarnings: %w", err)
	}
	platformFee, err := decimal.NewFromString(payload.Amount.PlatformFee)
	if err != nil {
		return fmt.Errorf("parse platformFee: %w", err)
	}
	taxAmount, err := decimal.NewFromString(payload.Amount.TaxAmount)
	if err != nil {
		return fmt.Errorf("parse taxAmount: %w", err)
	}
	total, err := decimal.NewFromString(payload.Amount.Total)
	if err != nil {
		return fmt.Errorf("parse total: %w", err)
	}

	if total.IsZero() || total.IsNegative() {
		return fmt.Errorf("invalid total: %s", total.String())
	}

	// Post the ledger transaction (atomic)
	err = c.ledger.PostTransaction(ctx, ledger.Transaction{
		EventID:     evt.ID,
		Type:        ledger.TxTypeOrderPaid,
		Reference:   payload.OrderID,
		Currency:    payload.Amount.Currency,
		OccurredAt:  evt.OccurredAt,
		Metadata: map[string]any{
			"buyer_id":  payload.BuyerID,
			"author_id": payload.AuthorID,
		},
		Entries: []ledger.Entry{
			// Debit: platform holds the revenue (unsettled)
			{
				AccountType: "platform",
				AccountKey:  "revenue",
				Debit:       total,
				Credit:      decimal.Zero,
			},
			// Credit: author's available balance
			{
				AccountType: "author",
				AccountKey:  payload.AuthorID,
				Debit:       decimal.Zero,
				Credit:      authorEarnings,
			},
			// Credit: platform fee
			{
				AccountType: "platform",
				AccountKey:  "fees",
				Debit:       decimal.Zero,
				Credit:      platformFee,
			},
			// Credit: tax collected (held for remittance to authority)
			{
				AccountType: "tax",
				AccountKey:  "collected",
				Debit:       decimal.Zero,
				Credit:      taxAmount,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("post ledger tx: %w", err)
	}

	c.log.Info("order_paid_credited",
		zap.String("order_id", payload.OrderID),
		zap.String("author_id", payload.AuthorID),
		zap.String("author_earnings", authorEarnings.String()),
	)

	return nil
}

// handleRefundIssued reverses the ledger entries for a refunded order.
//
// On RefundIssued:
//   - Debit  author:available     (author_earnings)  — claw back
//   - Debit  platform:fees        (platform_fee)     — claw back
//   - Debit  tax:collected        (tax_amount)       — claw back
//   - Credit platform:revenue     (total)            — reverse the debit
//
// If the author's available balance is insufficient (e.g., already paid
// out), we allow the balance to go negative — this is standard practice
// for accounting: the author "owes" the platform, and future earnings
// offset it.
func (c *EventConsumer) handleRefundIssued(ctx context.Context, evt Event) error {
	var payload struct {
		OrderID  string `json:"orderId"`
		BuyerID  string `json:"buyerId"`
		AuthorID string `json:"authorId"`
		Amount   struct {
			Subtotal       string `json:"subtotal"`
			TaxAmount      string `json:"taxAmount"`
			PlatformFee    string `json:"platformFee"`
			AuthorEarnings string `json:"authorEarnings"`
			Total          string `json:"total"`
			Currency       string `json:"currency"`
		} `json:"amount"`
	}

	if err := json.Unmarshal(evt.Payload, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}

	authorEarnings, err := decimal.NewFromString(payload.Amount.AuthorEarnings)
	if err != nil {
		return fmt.Errorf("parse authorEarnings: %w", err)
	}
	platformFee, err := decimal.NewFromString(payload.Amount.PlatformFee)
	if err != nil {
		return fmt.Errorf("parse platformFee: %w", err)
	}
	taxAmount, err := decimal.NewFromString(payload.Amount.TaxAmount)
	if err != nil {
		return fmt.Errorf("parse taxAmount: %w", err)
	}
	total, err := decimal.NewFromString(payload.Amount.Total)
	if err != nil {
		return fmt.Errorf("parse total: %w", err)
	}

	err = c.ledger.PostTransaction(ctx, ledger.Transaction{
		EventID:    evt.ID,
		Type:       ledger.TxTypeRefundIssued,
		Reference:  payload.OrderID,
		Currency:   payload.Amount.Currency,
		OccurredAt: evt.OccurredAt,
		Metadata: map[string]any{
			"buyer_id":  payload.BuyerID,
			"author_id": payload.AuthorID,
		},
		Entries: []ledger.Entry{
			// Reverse: debit author, credit platform revenue
			{
				AccountType: "author",
				AccountKey:  payload.AuthorID,
				Debit:       authorEarnings,
				Credit:      decimal.Zero,
			},
			{
				AccountType: "platform",
				AccountKey:  "fees",
				Debit:       platformFee,
				Credit:      decimal.Zero,
			},
			{
				AccountType: "tax",
				AccountKey:  "collected",
				Debit:       taxAmount,
				Credit:      decimal.Zero,
			},
			{
				AccountType: "platform",
				AccountKey:  "revenue",
				Debit:       decimal.Zero,
				Credit:      total,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("post refund tx: %w", err)
	}

	c.log.Info("refund_reversed",
		zap.String("order_id", payload.OrderID),
		zap.String("author_id", payload.AuthorID),
	)

	return nil
}

// isProcessed returns true if the event has already been handled.
func (c *EventConsumer) isProcessed(ctx context.Context, eventID string) (bool, error) {
	var exists bool
	err := c.cfg.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM processed_events WHERE event_id = $1)`,
		eventID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// kafkaLogger adapts zap.Logger to kafka-go's Logger interface.
type kafkaLogger struct{ log *zap.Logger }

func (k *kafkaLogger) Printf(format string, args ...any) {
	if k.log != nil {
		k.log.Debug("kafka", zap.String("msg", fmt.Sprintf(format, args...)))
	}
}

// min returns the smaller of two ints (Go 1.21 has builtin, but we keep
// this here for clarity in older toolchains).
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// silence unused imports
var (
	_ = pgx.ErrNoRows
	_ = uuid.New
)