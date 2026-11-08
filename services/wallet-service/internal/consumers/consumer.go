// Package consumers — the Kafka event consumers for wallet-service.
//
// ARCHITECTURE NOTE:
//   This package (`consumers`) is a thin facade over the actual
//   implementation in `internal/consumer` (singular). We split the
//   public surface into per-event files (`order_paid.go`,
//   `refund_issued.go`) for readability and to make it obvious which
//   handlers exist.
//
//   The `consumer` (singular) package owns the Kafka reader loop and
//   the dispatch logic. This file re-exports the types and handlers
//   so callers can import either package.
//
// If you're looking for the ACTUAL Kafka consumption loop, see
// `internal/consumer/event_consumer.go`.
package consumers

import (
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	core "github.com/talvoapp/universal-publishing/wallet-service/internal/consumer"
)

// Event is a re-export of the envelope type from the core consumer.
type Event = core.Event

// Config is a re-export of the consumer Config.
type Config = core.Config

// Consumer is the concrete event consumer implementation.
type Consumer = core.EventConsumer

// NewConsumer creates a Consumer wired to the config.
//
// This is a thin wrapper that fills the Logger + Brokers + Topic from
// the service config. The core constructor also accepts DB, Redis,
// Stripe, and PlatformFeePct which are provided by the caller (main).
func NewConsumer(cfg *config.Config, log *zap.Logger, deps Deps) *Consumer {
	return core.NewEventConsumer(core.Config{
		Brokers:        cfg.KafkaBrokerList(),
		Topic:          cfg.KafkaOutboxTopic,
		GroupID:        cfg.KafkaConsumerGroup,
		ClientID:       cfg.KafkaClientID,
		DB:             deps.DB,
		Redis:          deps.Redis,
		Stripe:         deps.Stripe,
		Logger:         log,
		PlatformFeePct: cfg.PlatformFeePercent,
	})
}

// Deps groups the external dependencies required by the consumer.
type Deps struct {
	DB     DB
	Redis  Redis
	Stripe Stripe
}

// ------------------------------------------------------------
// Dependency types (kept as interfaces for future mocking)
// ------------------------------------------------------------
// For v1, these are the concrete types from the driver libraries.
// In v2, extract to interfaces for easier unit testing of the consumer
// in isolation.

// DB is the PostgreSQL pool used by the consumer.
type DB = interface{}

// Redis is the Redis client used by the consumer.
type Redis = interface{}

// Stripe is the Stripe API client used by the consumer (for refunds).
type Stripe = interface{}

// ------------------------------------------------------------
// Dispatch map (documents which events are handled)
// ------------------------------------------------------------
// Handler names are declared here for reference; the actual
// implementations are in `order_paid.go` and `refund_issued.go`
// (which delegate to the core consumer).
//
//   OrderPaid     → handled by HandleOrderPaid (order_paid.go)
//   RefundIssued  → handled by HandleRefundIssued (refund_issued.go)
//
// Unknown event types are ignored (logged at debug level) so that the
// wallet-service is forward-compatible with new event types emitted by
// other services.

// Silence unused import
var _ = zap.NewNop