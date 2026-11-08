// Package consumers — the Kafka event consumers for feed-service.
//
// ARCHITECTURE NOTE:
//   This package (`consumers`, plural) is a thin facade over the actual
//   implementation in `internal/consumer` (singular). We split the
//   public surface into per-event files (`post_published.go`) for
//   readability and to make it obvious which handlers exist.
//
//   The `consumer` (singular) package owns the Kafka reader loop.
//   This file re-exports the types and provides a convenience
//   constructor so callers can import either package.
//
// If you're looking for the ACTUAL Kafka consumption loop, see
// `internal/consumer/event_consumer.go`.
package consumers

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	core "github.com/talvoapp/universal-publishing/feed-service/internal/consumer"
	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
)

// Event is a re-export of the envelope type from the core consumer.
type Event = core.Event

// Config is a re-export of the consumer Config.
type Config = core.Config

// Consumer is the concrete event consumer implementation.
type Consumer = core.EventConsumer

// NewConsumer creates a Consumer wired to the config + pusher.
//
// This is a thin wrapper that fills the config from the service-level
// config (brokers, topic, group) and provides the Pusher so the
// consumer doesn't need to construct one itself.
func NewConsumer(
	brokers []string,
	topic, groupID, clientID string,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	log *zap.Logger,
	celebrityThreshold, timelineMaxSize, fanoutCap int,
) *Consumer {
	return core.NewEventConsumer(core.Config{
		Brokers:            brokers,
		Topic:              topic,
		GroupID:            groupID,
		ClientID:           clientID,
		DB:                 pool,
		Redis:              rdb,
		Logger:             log,
		CelebrityThreshold: celebrityThreshold,
		TimelineMaxSize:    timelineMaxSize,
		TimelineFanoutCap:  fanoutCap,
	})
}

// NewPusher is a convenience constructor for the write-side pusher.
// Used directly by tests and admin tools that want to simulate
// a DraftPublished event without the Kafka loop.
func NewPusher(
	pool *pgxpool.Pool,
	rdb *redis.Client,
	log *zap.Logger,
	timelineMaxSize, fanoutCap int,
) *feed.Pusher {
	return feed.NewPusher(feed.PusherConfig{
		Redis:           rdb,
		DB:              pool,
		Logger:          log,
		TimelineMaxSize: timelineMaxSize,
		FanoutCap:       fanoutCap,
	})
}

// ------------------------------------------------------------
// Dispatch map (documents which events are handled)
// ------------------------------------------------------------
// Handler names are declared here for reference; the actual
// implementations are in `post_published.go` (which delegates to
// the core consumer) and `internal/consumer/event_consumer.go`.
//
//   DraftPublished  → handled by HandleDraftPublished (post_published.go)
//
// Unknown event types are ignored (logged at debug level) so that
// feed-service is forward-compatible with new event types emitted
// by other services.