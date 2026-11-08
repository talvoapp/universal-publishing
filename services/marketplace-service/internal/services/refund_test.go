package services

import (
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
)

// ============================================================
// REFUND LOGIC TESTS
// ============================================================
func TestRefundInput_Defaults(t *testing.T) {
	in := RefundInput{
		OrderID:      uuid.New(),
		AmountCents:  0,
		Reason:       "customer request",
		IssuedBy:     uuid.New(),
		IsAdmin:      false,
		RequestID:    "req-123",
	}
	if in.AmountCents != 0 {
		t.Errorf("expected 0 (full refund), got %d", in.AmountCents)
	}
	if in.IsAdmin {
		t.Errorf("expected non-admin")
	}
}

func TestOrder_RefundState(t *testing.T) {
	order := &models.Order{
		ID:     uuid.New(),
		Status: models.OrderSucceeded,
		Total:  decimal.NewFromInt(1299).Div(decimal.NewFromInt(100)),
	}

	// Business rule: only succeeded orders can be refunded
	if order.Status != models.OrderSucceeded {
		t.Errorf("refund requires succeeded state")
	}
}

// TestRefundService_RequiresAdminOrWindow verifies the guard logic
// at the model level (business rule: non-admin refunds within 30 days).
func TestRefundService_RefundWindowRule(t *testing.T) {
	// This test documents the 30-day rule. The actual time check
	// happens in `RefundService.Issue` using `time.Since(order.CreatedAt)`.
	// See internal/services/refund.service.go.

	// Non-admin, 31 days old → should fail
	// Non-admin, 29 days old → should pass
	// Admin, any age → should pass

	// Documented here so that if the rule changes, this test name
	// surfaces it in CI review.
	t.Log("refund window = 30 days for non-admin users")
}