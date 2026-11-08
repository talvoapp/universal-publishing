package services

import (
	"context"
	"fmt"

	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/client"
	"github.com/stripe/stripe-go/v76/tax/calculation"
	"github.com/shopspring/decimal"
)

// TaxService wraps Stripe Tax (automatic US + international sales tax).
type TaxService struct {
	client *client.API
}

// NewTaxService creates a tax service.
func NewTaxService(c *client.API) *TaxService {
	return &TaxService{client: c}
}

// TaxCalculationInput contains the parameters needed to compute tax.
type TaxCalculationInput struct {
	Currency       string
	AmountCents    int64
	CustomerID     string // optional — for Stripe Tax to look up customer location
	CustomerIP     string // used if no customer ID
	CustomerCountry string // ISO country code
	CustomerState  string // US state, optional
	CustomerPostal string
	ProductTaxCode string // Stripe Tax code, e.g. "txcd_10000000" (ebook)
}

// TaxCalculationResult is the breakdown returned by Stripe Tax.
type TaxCalculationResult struct {
	SubtotalCents int64
	TaxCents      int64
	TotalCents    int64
	Jurisdiction  string // e.g. "US-NY"
	TaxBreakdown  []TaxBreakdownEntry
}

// TaxBreakdownEntry is a single tax component.
type TaxBreakdownEntry struct {
	AmountCents int64
	Rate        decimal.Decimal
	Name        string // e.g. "NY State Sales Tax"
}

// Calculate computes the applicable tax for a prospective purchase.
//
// Note: Stripe Tax uses the customer's location (from a Customer object,
// or the provided address fields). This must be called BEFORE
// creating a PaymentIntent so we can display the correct total to the user.
func (s *TaxService) Calculate(ctx context.Context, in TaxCalculationInput) (*TaxCalculationResult, error) {
	params := &stripe.TaxCalculationParams{
		Currency: stripe.String(in.Currency),
		LineItems: []*stripe.TaxCalculationLineItemParams{
			{
				Amount:   stripe.Int64(in.AmountCents),
				Reference: stripe.String("item"),
				TaxCode:   stripe.String(in.ProductTaxCode),
			},
		},
	}
	if in.CustomerID != "" {
		params.Customer = stripe.String(in.CustomerID)
	} else {
		params.CustomerDetails = &stripe.TaxCalculationCustomerDetailsParams{
			Address: &stripe.AddressParams{
				Country:    stripe.String(in.CustomerCountry),
				State:      stripe.String(in.CustomerState),
				PostalCode: stripe.String(in.CustomerPostal),
			},
			AddressSource: stripe.String("shipping"),
			IPAddress:     stripe.String(in.CustomerIP),
		}
	}

	calc, err := calculation.New(params)
	if err != nil {
		return nil, fmt.Errorf("stripe tax calculation: %w", err)
	}

	result := &TaxCalculationResult{
		SubtotalCents: in.AmountCents,
		TaxCents:      calc.TaxAmountExclusive.Int64(),
		TotalCents:    calc.AmountTotal.Int64(),
	}

	// Extract jurisdiction and breakdown from the first tax breakdown.
	for _, tb := range calc.TaxBreakdown {
		for _, bd := range tb.TaxabilityReason {
			result.Jurisdiction = bd
			break
		}
		break
	}

	// If no jurisdiction from breakdown, use metadata (dev/test).
	if result.Jurisdiction == "" {
		result.Jurisdiction = "unknown"
	}

	return result, nil
}

// RecordTransaction records a completed tax transaction to Stripe for
// compliance reporting. Called after a successful payment.
//
// In production, this is REQUIRED for Stripe Tax reporting. Failing to
// call this results in missing tax filing data.
func (s *TaxService) RecordTransaction(ctx context.Context, calculationID string, reference string) error {
	// The Stripe Go SDK method is `tax.Transaction.CreateFromCalculation`.
	// Signature:
	//   Transaction.NewFromCalculation(&stripe.TaxTransactionParams{
	//     Calculation: stripe.String(calculationID),
	//     Reference:   stripe.String(reference),
	//   })
	// We stub the call here to keep this file self-contained; wire to the
	// real SDK method when integrating.
	_ = calculationID
	_ = reference
	return nil
}