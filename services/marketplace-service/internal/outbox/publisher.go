// Package outbox implements a reliable event publisher to Kafka.
//
// Design:
//   - Events are written to the `outbox` table BEFORE the Kafka publish
//     (see handlers — they call `outbox.Insert` inside a tx).
//   - A background relay reads unpublished rows and publishes them to Kafka.
//   - The `publisher.go` (this file) is a thin Kafka producer used by the
//     relay and by code that can tolerate fire-and-forget delivery.
package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// Event is the canonical outbox event envelope.
type Event struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	AggregateID string         `json:"aggregateId"`
	OccurredAt  time.Time      `json:"occurredAt"`
	Payload     map[string]any `json:"payload"`
	Meta        EventMeta      `json:"meta"`
}

// EventMeta holds producer metadata.
type EventMeta struct {
	Service   string `json:"service"`
	Version   string `json:"version"`
	TraceID   string `json:"traceId,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// PublisherConfig configures the Kafka producer.
type PublisherConfig struct {
	Brokers  []string
	Topic    string
	ClientID string
	Logger   *zap.Logger
}

// Publisher writes events to Kafka.
type Publisher struct {
	writer *kafka.Writer
	topic  string
	log    *zap.Logger
}

// NewPublisher creates a Kafka producer with sensible defaults.
// It does NOT verify connectivity eagerly — the first publish will fail
// if Kafka is unreachable, and the caller decides how to handle it.
func NewPublisher(ctx context.Context, cfg PublisherConfig) (*Publisher, error) {
	if len(cfg.Brokers) == 0 {
		return nil, fmt.Errorf("no Kafka brokers configured")
	}
	if cfg.Topic == "" {
		return nil, fmt.Errorf("Kafka topic required")
	}

	w := &kafka.Writer{
		Addr:         kafka.TCP(cfg.Brokers...),
		Topic:        cfg.Topic,
		Balancer:     &kafka.Hash{}, // partition by key = aggregateID
		BatchTimeout: 100 * time.Millisecond,
		BatchSize:    100,
		RequiredAcks: kafka.RequireAll, // durability > latency
		Async:        false,             // sync writes for outbox relay
		Compression:  kafka.Snappy,
		Logger:       &kafkaLogger{log: cfg.Logger},
		ErrorLogger:  &kafkaLogger{log: cfg.Logger},
	}

	// Short connectivity probe — not fatal, just diagnostic.
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := w.WriteMessages(probeCtx, kafka.Message{
		Key:   []byte("probe"),
		Value: []byte(`{"type":"probe"}`),
	}); err != nil {
		cfg.Logger.Warn("kafka_probe_failed", zap.Error(err))
	} else {
		cfg.Logger.Info("kafka_producer_ready")
	}

	return &Publisher{writer: w, topic: cfg.Topic, log: cfg.Logger}, nil
}

// Publish sends a single event. Returns an error if Kafka write fails.
// The caller (relay) is expected to retry on error.
func (p *Publisher) Publish(ctx context.Context, evt Event) error {
	value, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	headers := []kafka.Header{
		{Key: "event-type", Value: []byte(evt.Type)},
		{Key: "event-id", Value: []byte(evt.ID)},
		{Key: "service", Value: []byte(evt.Meta.Service)},
		{Key: "occurred-at", Value: []byte(evt.OccurredAt.Format(time.RFC3339))},
	}

	msg := kafka.Message{
		Key:     []byte(evt.AggregateID),
		Value:   value,
		Headers: headers,
		Time:    evt.OccurredAt,
	}

	writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := p.writer.WriteMessages(writeCtx, msg); err != nil {
		return fmt.Errorf("kafka write: %w", err)
	}

	p.log.Debug("event_published",
		zap.String("event_id", evt.ID),
		zap.String("event_type", evt.Type),
		zap.String("aggregate_id", evt.AggregateID),
	)
	return nil
}

// Close flushes any in-flight messages and closes the writer.
func (p *Publisher) Close() error {
	if p.writer == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := p.writer.Close()
	_ = ctx
	return err
}

// kafkaLogger adapts zap.Logger to kafka-go's logger interface.
type kafkaLogger struct{ log *zap.Logger }

func (k *kafkaLogger) Printf(format string, args ...any) {
	if k.log != nil {
		k.log.Debug("kafka", zap.String("msg", fmt.Sprintf(format, args...)))
	}
}