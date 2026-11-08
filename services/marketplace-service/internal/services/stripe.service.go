// Package services implements the business logic layer. Each service
// is independently testable and takes explicit dependencies (no globals).
package services

import (
	"context"
	"fmt"

	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/checkout/session"
	"github.com/stripe/stripe-go/v76/client"
	"github.com/stripe/stripe-go/v76/paymentintent"
)

// StripeService wraps the Stripe API for checkout + webhook operations.
type StripeService struct {
	client *client.API
	// PublishableKey is returned to clients that need it (frontend).
	publishableKey string
}

// NewStripeService creates a Stripe service.
func NewStripeService(c *client.API, publishableKey string) *StripeService {
	return &StripeService{client: c, publishableKey: publishableKey}
}

// PublishableKey returns the Stripe publishable key.
func (s *StripeService) PublishableKey() string { return s.publishableKey }

// PaymentIntentInput is the input for CreatePaymentIntent.
type PaymentIntentInput struct {
	AmountCents       int64
	Currency          string
	CustomerID        string // optional — Stripe can create one on the fly
	Description       string
	Metadata          map[string]string
	IdempotencyKey    string // for Stripe's own idempotency
	// ConnectAccountID routes the payment to a connected author account.
	// Empty means "platform account" (for testing / one-off items).
	ConnectAccountID  string
	// ApplicationFeeCents is the platform's cut (used with Connect destination).
	ApplicationFeeCents int64
}

// CreatePaymentIntent creates a Stripe PaymentIntent for direct card payment.
//
// Two modes:
//   - Direct (ConnectAccountID == "") → payment goes to platform account.
//   - Connect (ConnectAccountID != "") → payment goes to the author's
//     connected account; the platform keeps `ApplicationFeeCents`.
func (s *StripeService) CreatePaymentIntent(ctx context.Context, in PaymentIntentInput) (*stripe.PaymentIntent, error) {
	params := &stripe.PaymentIntentParams{
		Amount:      stripe.Int64(in.AmountCents),
		Currency:    stripe.String(in.Currency),
		Description: stripe.String(in.Description),
		Metadata:    in.Metadata,
	}
	if in.CustomerID != "" {
		params.Customer = stripe.String(in.CustomerID)
	}
	if in.ConnectAccountID != "" {
		params.TransferData = &stripe.PaymentIntentTransferDataParams{
			Destination: stripe.String(in.ConnectAccountID),
		}
		if in.ApplicationFeeCents > 0 {
			params.ApplicationFeeAmount = stripe.Int64(in.ApplicationFeeCents)
		}
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}

	pi, err := s.client.PaymentIntents.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe paymentintent create: %w", err)
	}
	return pi, nil
}

// CheckoutSessionInput is the input for CreateCheckoutSession.
type CheckoutSessionInput struct {
	LineItems      []*stripe.CheckoutSessionLineItemParams
	Mode           string // "payment" | "subscription"
	SuccessURL     string
	CancelURL      string
	CustomerEmail  string
	CustomerID     string
	Metadata       map[string]string
	ClientReferenceID string
	IdempotencyKey string
	// ConnectAccountID + fee used for Connect checkout.
	ConnectAccountID    string
	ApplicationFeeCents int64
}

// CreateCheckoutSession creates a Stripe Checkout Session (hosted payment page).
// Returns a Session with `URL` set for redirecting the browser.
func (s *StripeService) CreateCheckoutSession(ctx context.Context, in CheckoutSessionInput) (*stripe.CheckoutSession, error) {
	params := &stripe.CheckoutSessionParams{
		LineItems:         in.LineItems,
		Mode:              stripe.String(in.Mode),
		SuccessURL:        stripe.String(in.SuccessURL),
		CancelURL:         stripe.String(in.CancelURL),
		ClientReferenceID: stripe.String(in.ClientReferenceID),
		Metadata:          in.Metadata,
	}
	if in.CustomerEmail != "" {
		params.CustomerEmail = stripe.String(in.CustomerEmail)
	}
	if in.CustomerID != "" {
		params.Customer = stripe.String(in.CustomerID)
	}
	if in.ConnectAccountID != "" {
		params.PaymentIntentData = &stripe.CheckoutSessionPaymentIntentDataParams{
			ApplicationFeeAmount: stripe.Int64(in.ApplicationFeeCents),
			TransferData: &stripe.CheckoutSessionPaymentIntentDataTransferDataParams{
				Destination: stripe.String(in.ConnectAccountID),
			},
		}
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}

	sess, err := s.client.CheckoutSessions.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe checkout create: %w", err)
	}
	return sess, nil
}

// RetrievePaymentIntent fetches a PaymentIntent by ID.
func (s *StripeService) RetrievePaymentIntent(ctx context.Context, id string) (*stripe.PaymentIntent, error) {
	pi, err := s.client.PaymentIntents.Get(id, nil)
	if err != nil {
		return nil, fmt.Errorf("stripe paymentintent get: %w", err)
	}
	return pi, nil
}

// RefundInput is the input for Refund.
type RefundInput struct {
	PaymentIntentID string
	AmountCents     int64 // 0 = full refund
	Reason          string // "requested_by_customer" | "duplicate" | "fraudulent"
	Metadata        map[string]string
	IdempotencyKey  string
	// For Connect payments, this tells Stripe to reverse the transfer.
	RefundApplicationFee bool
	ReverseTransfer      bool
}

// Refund issues a refund against a PaymentIntent.
func (s *StripeService) Refund(ctx context.Context, in RefundInput) (*stripe.Refund, error) {
	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(in.PaymentIntentID),
		Metadata:      in.Metadata,
	}
	if in.AmountCents > 0 {
		params.Amount = stripe.Int64(in.AmountCents)
	}
	if in.Reason != "" {
		params.Reason = stripe.String(in.Reason)
	}
	if in.RefundApplicationFee {
		params.RefundApplicationFee = stripe.Bool(true)
	}
	if in.ReverseTransfer {
		params.ReverseTransfer = stripe.Bool(true)
	}
	if in.IdempotencyKey != "" {
		params.SetIdempotencyKey(in.IdempotencyKey)
	}

	refund, err := s.client.Refunds.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe refund: %w", err)
	}
	return refund, nil
}

// ConstructWebhookEvent verifies the Stripe signature and returns the event.
// Callers MUST verify before acting on any event payload.
func (s *StripeService) ConstructWebhookEvent(payload []byte, signatureHeader, webhookSecret string) (stripe.Event, error) {
	event, err := stripe.ConstructEvent(payload, signatureHeader, webhookSecret)
	if err != nil {
		return stripe.Event{}, fmt.Errorf("stripe webhook verify: %w", err)
	}
	return event, nil
}

// Ensure our imports are used (defensive; compiler will catch unused).
var (
	_ = paymentintent.New
	_ = session.New
)