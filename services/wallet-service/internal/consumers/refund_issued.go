package consumers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
)

// RefundIssuedPayload is the shape of the `RefundIssued` event payload.
//
// Emitted by marketplace-service when an admin or author issues a refund.
type RefundIssuedPayload struct {
	OrderID  string             `json:"orderId"`
	RefundID string             `json:"refundId,omitempty"`
	BuyerID  string             `json:"buyerId"`
	AuthorID string             `json:"authorId"`
	Amount   OrderPaidAmounts   `json:"amount"`
}

// HandleRefundIssued processes a `RefundIssued` event.
//
// Posts a REVERSING transaction:
//
//	Debit   author:{author_id}         author_earnings
//	Debit   platform:fees              platform_fee
//	Debit   tax:collected              tax_amount
//	Credit  platform:revenue           total
//
// The author's balance may go negative if they already withdrew the
// funds — this is standard accounting (author owes platform until next
// sale). The negative balance is visible in the wallet UI.
func HandleRefundIssued(
	ctx context.Context,
	ledgerSvc *ledger.Service,
	eventID string,
	occurredAt time.Time,
	payloadJSON []byte,
	log *zap.Logger,
) error {
	var payload RefundIssuedPayload
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return fmt.Errorf("unmarshal RefundIssued payload: %w", err)
	}

	if payload.OrderID == "" || payload.AuthorID == "" {
		return fmt.Errorf("missing orderId or authorId in RefundIssued payload")
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

	// Post the reversing transaction
	err = ledgerSvc.PostTransaction(ctx, ledger.Transaction{
		EventID:    eventID,
		Type:       ledger.TxTypeRefundIssued,
		Reference:  payload.OrderID,
		Currency:   payload.Amount.Currency,
		OccurredAt: occurredAt,
		Metadata: map[string]any{
			"buyer_id":  payload.BuyerID,
			"author_id": payload.AuthorID,
			"refund_id": payload.RefundID,
		},
		Entries: []ledger.Entry{
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
		return fmt.Errorf("post RefundIssued tx: %w", err)
	}

	log.Info("refund_reversed",
		zap.String("order_id", payload.OrderID),
		zap.String("author_id", payload.AuthorID),
		zap.String("event_id", eventID),
	)

	return nil
}