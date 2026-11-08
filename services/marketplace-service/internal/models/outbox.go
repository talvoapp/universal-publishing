package models

import (
	"time"

	"github.com/google/uuid"
)

// OutboxRow represents a pending outbox event in the `outbox` table.
// Rows are inserted inside business transactions, then picked up by the
// relay (see `internal/outbox/relay.go`) and published to Kafka.
type OutboxRow struct {
	ID          uuid.UUID  `json:"id"`
	EventType   string     `json:"eventType"`
	AggregateID string     `json:"aggregateId"`
	Payload     []byte     `json:"payload"` // raw JSON
	Meta        []byte     `json:"meta"`    // raw JSON
	CreatedAt   time.Time  `json:"createdAt"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
	Attempts    int        `json:"attempts"`
	LastError   string     `json:"lastError,omitempty"`
}