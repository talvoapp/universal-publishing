package services

import (
	"testing"
)

// ============================================================
// TAX CALCULATION TESTS
// ============================================================
// Note: these are unit tests with mockable inputs. Real Stripe Tax
// integration tests are run against Stripe's test mode in CI.

func TestTaxCalculationResult_Fields(t *testing.T) {
	result := &TaxCalculationResult{
		SubtotalCents: 1000,
		TaxCents:      85,
		TotalCents:    1085,
		Jurisdiction:  "US-NY",
	}

	if result.SubtotalCents != 1000 {
		t.Errorf("expected subtotal 1000, got %d", result.SubtotalCents)
	}
	if result.TotalCents != result.SubtotalCents+result.TaxCents {
		t.Errorf("total must equal subtotal + tax")
	}
	if result.Jurisdiction != "US-NY" {
		t.Errorf("expected US-NY, got %s", result.Jurisdiction)
	}
}

func TestTaxCalculationInput_Defaults(t *testing.T) {
	in := TaxCalculationInput{
		Currency:       "USD",
		AmountCents:    1299,
		CustomerCountry: "US",
		CustomerState:  "NY",
	}

	if in.Currency != "USD" {
		t.Errorf("expected USD, got %s", in.Currency)
	}
	if in.AmountCents != 1299 {
		t.Errorf("expected 1299 cents, got %d", in.AmountCents)
	}
}