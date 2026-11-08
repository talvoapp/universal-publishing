package services

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/client"
	"github.com/stripe/stripe-go/v76/transfer"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/ledger"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/models"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// PayoutService handles author payout requests.
type PayoutService struct {
	cfg        *config.Config
	db         *pgxpool.Pool
	stripe     *client.API
	log        *zap.Logger
	ledgerSvc  *ledger.Service
}

// NewPayoutService creates a payout service.
func NewPayoutService(cfg *config.Config, db *pgxpool.Pool, stripe *client.API, log *zap.Logger) *PayoutService {
	return &PayoutService{
		cfg:       cfg,
		db:        db,
		stripe:    stripe,
		log:       log,
		ledgerSvc: ledger.NewService(db, log),
	}
}

// RequestPayoutInput is the input for RequestPayout.
type RequestPayoutInput struct {
	AuthorID  string
	Amount    decimal.Decimal
	Currency  string
	RequestID string
}

// RequestPayout creates a payout request.
func (s *PayoutService) RequestPayout(ctx context.Context, in RequestPayoutInput) (*models.Payout, error) {
	// 1. Validate amount
	minAmount := decimal.NewFromInt(s.cfg.PayoutMinimumCents).Div(decimal.NewFromInt(100))
	maxAmount := decimal.NewFromInt(s.cfg.PayoutMaximumCents).Div(decimal.NewFromInt(100))

	if in.Amount.LessThan(minAmount) {
		return nil, utils.BadRequest(
			fmt.Sprintf("Minimum payout is %s %s", minAmount.StringFixed(2), in.Currency),
			"AMOUNT_TOO_LOW",
		)
	}
	if in.Amount.GreaterThan(maxAmount) {
		return nil, utils.BadRequest(
			fmt.Sprintf("Maximum payout is %s %s", maxAmount.StringFixed(2), in.Currency),
			"AMOUNT_TOO_HIGH",
		)
	}

	// 2. Check Connect status
	var stripeAccountID string
	var connectStatus string
	var payoutsEnabled bool
	err := s.db.QueryRow(ctx, `
		SELECT stripe_account_id, status, payouts_enabled
		FROM author_connect_accounts
		WHERE author_id = $1
	`, in.AuthorID).Scan(&stripeAccountID, &connectStatus, &payoutsEnabled)
	if err == pgx.ErrNoRows {
		return nil, utils.BadRequest("Please onboard a Connect account first", "NOT_ONBOARDED")
	}
	if err != nil {
		return nil, utils.Internal("Failed to check Connect status", err)
	}
	if connectStatus != "active" || !payoutsEnabled {
		return nil, utils.BadRequest(
			fmt.Sprintf("Connect account is %s — complete onboarding first", connectStatus),
			"CONNECT_NOT_READY",
		)
	}

	// 3. Check available balance
	available, _, err := ledger.AuthorBalances(ctx, s.db, in.AuthorID, in.Currency)
	if err != nil {
		return nil, utils.Internal("Failed to check balance", err)
	}
	if available.LessThan(in.Amount) {
		return nil, utils.BadRequest(
			fmt.Sprintf("Insufficient balance: available %s, requested %s",
				available.StringFixed(2), in.Amount.StringFixed(2)),
			"INSUFFICIENT_BALANCE",
		)
	}

	// 4. Debit the author's ledger (BEFORE Stripe — atomic)
	payoutID := uuid.New()
	eventID := uuid.NewString()

	err = s.ledgerSvc.PostTransaction(ctx, ledger.Transaction{
		EventID:    eventID,
		Type:       ledger.TxTypePayout,
		Reference:  payoutID.String(),
		Currency:   in.Currency,
		OccurredAt: time.Now(),
		Metadata: map[string]any{
			"author_id":  in.AuthorID,
			"request_id": in.RequestID,
		},
		Entries: []ledger.Entry{
			{
				AccountType: "author",
				AccountKey:  in.AuthorID,
				Debit:       in.Amount,
				Credit:      decimal.Zero,
			},
			{
				AccountType: "platform",
				AccountKey:  "payouts_clearing",
				Debit:       decimal.Zero,
				Credit:      in.Amount,
			},
		},
	})
	if err != nil {
		return nil, utils.Internal("Failed to reserve balance", err)
	}

	// 5. Create Stripe Transfer
	transferParams := &stripe.TransferParams{
		Amount:      stripe.Int64(in.Amount.Mul(decimal.NewFromInt(100)).IntPart()),
		Currency:    stripe.String(in.Currency),
		Destination: stripe.String(stripeAccountID),
		Description: stripe.String(fmt.Sprintf("Payout %s", payoutID.String())),
		Metadata: map[string]string{
			"payout_id": payoutID.String(),
			"author_id": in.AuthorID,
		},
	}
	transferParams.SetIdempotencyKey("payout-" + payoutID.String())

	stripeTransfer, stripeErr := transfer.New(transferParams)
	if stripeErr != nil {
		s.log.Error("stripe_transfer_failed",
			zap.Error(stripeErr),
			zap.String("payout_id", payoutID.String()),
		)

		// 6a. Reverse the ledger debit (compensating transaction)
		reverseEventID := uuid.NewString()
		_ = s.ledgerSvc.PostTransaction(ctx, ledger.Transaction{
			EventID:    reverseEventID,
			Type:       ledger.TxTypeAdjustment,
			Reference:  "reverse-" + payoutID.String(),
			Currency:   in.Currency,
			OccurredAt: time.Now(),
			Metadata: map[string]any{
				"reason":    "stripe_transfer_failed",
				"payout_id": payoutID.String(),
			},
			Entries: []ledger.Entry{
				{
					AccountType: "platform",
					AccountKey:  "payouts_clearing",
					Debit:       in.Amount,
					Credit:      decimal.Zero,
				},
				{
					AccountType: "author",
					AccountKey:  in.AuthorID,
					Debit:       decimal.Zero,
					Credit:      in.Amount,
				},
			},
		})

		return nil, utils.ServiceUnavailable("Payout failed — please retry", "STRIPE_TRANSFER_FAILED")
	}

	// 7. Record payout row
	now := time.Now()
	_, err = s.db.Exec(ctx, `
		INSERT INTO payouts (
			id, author_id, amount, currency, stripe_transfer_id,
			status, requested_at, requested_by
		) VALUES ($1, $2, $3, $4, $5, 'processing', $6, $2)
	`,
		payoutID, in.AuthorID, in.Amount, in.Currency, stripeTransfer.ID, now,
	)
	if err != nil {
		s.log.Error("payout_insert_failed",
			zap.Error(err),
			zap.String("payout_id", payoutID.String()),
			zap.String("stripe_transfer_id", stripeTransfer.ID),
		)
		return nil, utils.Internal("Failed to record payout — contact support", err)
	}

	s.log.Info("payout_requested",
		zap.String("payout_id", payoutID.String()),
		zap.String("author_id", in.AuthorID),
		zap.String("amount", in.Amount.String()),
		zap.String("stripe_transfer_id", stripeTransfer.ID),
	)

	return &models.Payout{
		ID:               payoutID,
		AuthorID:         uuid.MustParse(in.AuthorID),
		Amount:           in.Amount,
		Currency:         in.Currency,
		StripeTransferID: stripeTransfer.ID,
		Status:           models.PayoutProcessing,
		RequestedAt:      now,
		RequestedBy:      uuid.MustParse(in.AuthorID),
	}, nil
}