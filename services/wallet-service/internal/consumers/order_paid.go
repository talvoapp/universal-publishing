package consumers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
)

// OrderPaidPayload is the shape of the `OrderPaid` event payload.
//
// Emitted by marketplace-service when a Stripe Checkout Session
// completes successfully.
type OrderPaidPayload struct {
	OrderID  string           `json:"orderId"`
	BuyerID  string           `json:"buyerId"`
	AuthorID string           `json:"authorId"`
	Amount   OrderPaidAmounts `json:"amount"`
}

// OrderPaidAmounts is the money breakdown from the order.
type OrderPaidAmounts struct {
	Subtotal       string `json:"subtotal"`
	TaxAmount      string `json:"taxAmount"`
	PlatformFee    string `json:"platformFee"`
	AuthorEarnings string `json:"authorEarnings"`
	Total          string `json:"total"`
	Currency       string `json:"currency"`
}

// HandleOrderPaid processes an `OrderPaid` event.
//
// Ledger entries posted:
//
//	Debit   platform:revenue           total
//	Credit  author:{author_id}         author_earnings
//	Credit  platform:fees              platform_fee
//	Credit  tax:collected              tax_amount
//
// Called from `internal/consumer.handleOrderPaid` after the idempotency
// check passes. Exposed here as a standalone function so it can be
// unit-tested without the Kafka plumbing.
func HandleOrderPaid(
	ctx context.Context,
	ledgerSvc *ledger.Service,
	eventID string,
	occurredAt time.Time,
	payloadJSON []byte,
	log *zap.Logger,
) error {
	var payload OrderPaidPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return fmt.Errorf("unmarshal OrderPaid payload: %w", err)
	}

	// Validate
	if payload.OrderID == "" || payload.AuthorID == "" {
		return fmt.Errorf("missing orderId or authorId in OrderPaid payload")
	}

	// Parse amounts
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

	// Post the double-entry transaction
	err = ledgerSvc.PostTransaction(ctx, ledger.Transaction{
		EventID:    eventID,
		Type:       ledger.TxTypeOrderPaid,
		Reference:  payload.OrderID,
		Currency:   payload.Amount.Currency,
		OccurredAt: occurredAt,
		Metadata: map[string]any{
			"buyer_id":  payload.BuyerID,
			"author_id": payload.AuthorID,
		},
		Entries: []ledger.Entry{
			{
				AccountType: "platform",
				AccountKey:  "revenue",
				Debit:       total,
				Credit:      decimal.Zero,
			},
			{
				AccountType: "author",
				AccountKey:  payload.AuthorID,
				Debit:       decimal.Zero,
				Credit:      authorEarnings,
			},
			{
				AccountType: "platform",
				AccountKey:  "fees",
				Debit:       decimal.Zero,
				Credit:      platformFee,
			},
			{
				AccountType: "tax",
				AccountKey:  "collected",
				Debit:       decimal.Zero,
				Credit:      taxAmount,
			},
		},
	})
	if err != nil {
		return fmt.Errorf("post OrderPaid tx: %w", err)
	}

	log.Info("order_paid_credited",
		zap.String("order_id", payload.OrderID),
		zap.String("author_id", payload.AuthorID),
		zap.String("author_earnings", authorEarnings.String()),
		zap.String("event_id", eventID),
	)

	return nil
}

// Silence unused import
var _ = uuid.New