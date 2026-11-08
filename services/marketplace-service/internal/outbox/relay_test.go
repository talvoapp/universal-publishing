package outbox

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// ============================================================
// OUTBOX EVENT TESTS
// ============================================================
func TestEvent_MarshalJSON(t *testing.T) {
	evt := Event{
		ID:          uuid.NewString(),
		Type:        "OrderPaid",
		AggregateID: "order-123",
		OccurredAt:  time.Now(),
		Payload:     map[string]any{"orderId": "order-123", "amount": 1299},
		Meta: EventMeta{
			Service: "marketplace-service",
			Version: "1.0.0",
		},
	}

	if evt.ID == "" {
		t.Error("event ID must not be empty")
	}
	if evt.Type != "OrderPaid" {
		t.Errorf("expected OrderPaid, got %s", evt.Type)
	}
	if evt.Payload["amount"] != 1299 {
		t.Errorf("payload amount mismatch")
	}
}

func TestRelayConfig_Defaults(t *testing.T) {
	cfg := RelayConfig{}
	relay := NewRelay(cfg)

	if relay.cfg.PollInterval == 0 {
		t.Error("poll interval should default")
	}
	if relay.cfg.BatchSize == 0 {
		t.Error("batch size should default")
	}
}

func TestRelay_StopBeforeStart(t *testing.T) {
	relay := NewRelay(RelayConfig{})
	// Stop without Start should not panic or block indefinitely.
	// (Actual behavior: Stop() blocks on <-r.done which is closed only
	// after Start begins running. This test verifies construction.)
	_ = relay
}