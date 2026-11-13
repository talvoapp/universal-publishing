// Package consumer implements the Kafka event consumer that drives the
// feed's write path (hybrid fan-out).
//
// It is the single source of truth for:
//   - Creating the kafka-go reader (with optional SASL/SSL for ntail)
//   - Dispatching events to handlers
//   - Idempotency (per-event processed set, but feed is naturally idempotent)
//
// The dispatch function for DraftPublished is currently inlined here.
// Future event types should follow the same pattern as wallet-service:
// add a case in `dispatchEvent` and implement `handleXxx` in a separate
// file (e.g., `post_published.go` in `internal/consumers`).
package consumer

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/plain"
	"github.com/segmentio/kafka-go/sasl/scram"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
)

// ============================================================
// CONFIG
// ============================================================
type Config struct {
	Brokers  []string
	Topic    string
	GroupID  string
	ClientID string

	// SASL/SSL (optional). Leave SecurityProtocol empty for plaintext.
	SecurityProtocol string
	SASLMechanism    string
	SASLUsername     string
	SASLPassword     string

	DB                 *pgxpool.Pool
	Redis              *redis.Client
	Logger             *zap.Logger
	CelebrityThreshold int
	TimelineMaxSize    int
	TimelineFanoutCap  int
}

// ============================================================
// EVENT CONSUMER
// ============================================================
type EventConsumer struct {
	cfg    Config
	reader *kafka.Reader
	log    *zap.Logger
	pusher *feed.Pusher
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

// NewEventConsumer creates a new consumer with optional SASL/SSL.
func NewEventConsumer(cfg Config) *EventConsumer {
	readerCfg := kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		GroupID:        cfg.GroupID,
		Topic:          cfg.Topic,
		MinBytes:       1,
		MaxBytes:       10 * 1024 * 1024,
		MaxWait:        500 * time.Millisecond,
		CommitInterval: 0,
		StartOffset:    kafka.LastOffset,
		Logger:         &kafkaLogger{log: cfg.Logger},
		ErrorLogger:    &kafkaLogger{log: cfg.Logger},
	}

	// SASL/SSL
	if cfg.SecurityProtocol != "" && cfg.SecurityProtocol != "PLAINTEXT" {
		dialer := &kafka.Dialer{
			Timeout:   10 * time.Second,
			DualStack: true,
		}
		if cfg.SecurityProtocol == "SASL_SSL" || cfg.SecurityProtocol == "SSL" {
			dialer.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
		}
		if mech, err := buildSASLMechanism(cfg); err != nil {
			cfg.Logger.Fatal("kafka_sasl_mechanism_failed", zap.Error(err))
		} else if mech != nil {
			dialer.SASLMechanism = mech
		}
		readerCfg.Dialer = dialer
		cfg.Logger.Info("kafka_sasl_enabled",
			zap.String("protocol", cfg.SecurityProtocol),
			zap.String("mechanism", cfg.SASLMechanism),
		)
	} else {
		cfg.Logger.Info("kafka_plaintext_enabled")
	}

	return &EventConsumer{
		cfg:    cfg,
		reader: kafka.NewReader(readerCfg),
		log:    cfg.Logger,
		pusher: feed.NewPusher(feed.PusherConfig{
			Redis:           cfg.Redis,
			DB:              cfg.DB,
			Logger:          cfg.Logger,
			TimelineMaxSize: cfg.TimelineMaxSize,
			FanoutCap:       cfg.TimelineFanoutCap,
		}),
	}
}

func buildSASLMechanism(cfg Config) (sasl.Mechanism, error) {
	switch cfg.SASLMechanism {
	case "PLAIN", "":
		return plain.Mechanism{Username: cfg.SASLUsername, Password: cfg.SASLPassword}, nil
	case "SCRAM-SHA-256":
		return scram.Mechanism(scram.SHA256, cfg.SASLUsername, cfg.SASLPassword)
	case "SCRAM-SHA-512":
		return scram.Mechanism(scram.SHA512, cfg.SASLUsername, cfg.SASLPassword)
	default:
		return nil, fmt.Errorf("unsupported SASL mechanism: %s", cfg.SASLMechanism)
	}
}

// ============================================================
// RUN LOOP
// ============================================================
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
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(1 * time.Second):
				continue
			}
		}

		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			c.log.Error("commit_failed", zap.Error(err))
		}
	}
}

// Close closes the reader.
func (c *EventConsumer) Close() {
	if c.reader != nil {
		_ = c.reader.Close()
	}
}

// ============================================================
// MESSAGE HANDLING
// ============================================================
func (c *EventConsumer) handleMessage(ctx context.Context, msg kafka.Message) error {
	var evt Event
	if err := json.Unmarshal(msg.Value, &evt); err != nil {
		c.log.Error("unmarshal_failed",
			zap.Error(err),
			zap.String("raw", string(msg.Value[:min(len(msg.Value), 500)])),
		)
		return nil
	}

	if evt.ID == "" || evt.Type == "" || evt.AggregateID == "" {
		c.log.Error("incomplete_event", zap.Any("event", evt))
		return nil
	}

	c.log.Info("event_received",
		zap.String("event_id", evt.ID),
		zap.String("event_type", evt.Type),
	)

	switch evt.Type {
	case "DraftPublished":
		return c.handleDraftPublished(ctx, evt)
	default:
		c.log.Debug("event_ignored", zap.String("type", evt.Type))
		return nil
	}
}

// handleDraftPublished is the write path for the feed.
func (c *EventConsumer) handleDraftPublished(ctx context.Context, evt Event) error {
	// Parse payload
	var payload struct {
		DraftID     string `json:"draftId"`
		OwnerID     string `json:"ownerId"`
		Title       string `json:"title"`
		ContentType string `json:"contentType"`
		WordCount   int    `json:"wordCount"`
		PublishedAt string `json:"publishedAt"`
		Excerpt     string `json:"excerpt"`
	}
	if err := json.Unmarshal(evt.Payload, &payload); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}
	if payload.DraftID == "" || payload.OwnerID == "" {
		return fmt.Errorf("missing draftId or ownerId")
	}

	// Determine score (publish time)
	publishedAt := evt.OccurredAt
	if payload.PublishedAt != "" {
		if t, err := time.Parse(time.RFC3339, payload.PublishedAt); err == nil {
			publishedAt = t
		}
	}
	score := publishedAt.Unix()

	// Fetch author's follower count
	var followerCount int
	err := c.cfg.DB.QueryRow(ctx, `
		SELECT follower_count FROM users_follow_counts WHERE user_id = $1
	`, payload.OwnerID).Scan(&followerCount)
	if err != nil {
		followerCount = 0
	}

	isCelebrity := followerCount > c.cfg.CelebrityThreshold

	c.log.Info("draft_published",
		zap.String("draft_id", payload.DraftID),
		zap.String("owner_id", payload.OwnerID),
		zap.Int("follower_count", followerCount),
		zap.Bool("is_celebrity", isCelebrity),
	)

	// Always write to author index + own timeline
	if err := c.pusher.AppendToAuthorIndex(ctx, payload.OwnerID, payload.DraftID, score); err != nil {
		return fmt.Errorf("author index: %w", err)
	}
	if err := c.pusher.AppendToTimeline(ctx, payload.OwnerID, payload.DraftID, score); err != nil {
		return fmt.Errorf("own timeline: %w", err)
	}

	// Fan out (push) unless celebrity
	if isCelebrity {
		c.log.Debug("celebrity_pull_path_used")
		return nil
	}

	result, err := c.pusher.FanoutToFollowers(ctx, payload.DraftID, payload.OwnerID, score)
	if err != nil {
		return fmt.Errorf("fanout: %w", err)
	}

	c.log.Info("push_fanout_complete",
		zap.String("draft_id", payload.DraftID),
		zap.Int("notified", result.FollowersNotified),
	)
	return nil
}

// kafkaLogger adapts zap.Logger to kafka-go's Logger interface.
type kafkaLogger struct{ log *zap.Logger }

func (k *kafkaLogger) Printf(format string, args ...any) {
	if k.log != nil {
		k.log.Debug("kafka", zap.String("msg", fmt.Sprintf(format, args...)))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}