package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/accountlink"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// ConnectService handles Stripe Connect account onboarding.
type ConnectService struct {
	cfg    *config.Config
	db     *pgxpool.Pool
	stripe *client.API
	log    *zap.Logger
}

// NewConnectService creates a Connect service.
func NewConnectService(cfg *config.Config, db *pgxpool.Pool, stripe *client.API, log *zap.Logger) *ConnectService {
	return &ConnectService{cfg: cfg, db: db, stripe: stripe, log: log}
}

// OnboardingInput is the input for GetOnboardingURL.
type OnboardingInput struct {
	AuthorID string
	Email    string
}

// ConnectStatus is the response from GetStatus.
type ConnectStatus struct {
	Status           string   `json:"status"`
	ChargesEnabled   bool     `json:"chargesEnabled"`
	PayoutsEnabled   bool     `json:"payoutsEnabled"`
	DetailsSubmitted bool     `json:"detailsSubmitted"`
	RequirementsDue  []string `json:"requirementsDue"`
}

// GetOnboardingURL returns a Stripe-hosted onboarding URL.
func (s *ConnectService) GetOnboardingURL(ctx context.Context, in OnboardingInput) (string, error) {
	// 1. Look up existing account
	var stripeAccountID string
	err := s.db.QueryRow(ctx,
		`SELECT stripe_account_id FROM author_connect_accounts WHERE author_id = $1`,
		in.AuthorID,
	).Scan(&stripeAccountID)

	// 2. Create if not exists
	if err == pgx.ErrNoRows {
		params := &stripe.AccountParams{
			Type:    stripe.String(string(stripe.AccountTypeExpress)),
			Country: stripe.String("US"),
			Email:   stripe.String(in.Email),
			Capabilities: &stripe.AccountCapabilitiesParams{
				CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{
					Requested: stripe.Bool(true),
				},
				Transfers: &stripe.AccountCapabilitiesTransfersParams{
					Requested: stripe.Bool(true),
				},
			},
			BusinessType: stripe.String("individual"),
		}
		acct, err := s.stripe.Accounts.New(params)
		if err != nil {
			s.log.Error("stripe_connect_create_failed", zap.Error(err))
			return "", utils.ServiceUnavailable("Failed to create Connect account", "STRIPE_ERROR")
		}
		stripeAccountID = acct.ID

		_, err = s.db.Exec(ctx, `
			INSERT INTO author_connect_accounts (
				author_id, stripe_account_id, status, last_stripe_sync_at
			) VALUES ($1, $2, 'pending', now())
			ON CONFLICT (author_id) DO UPDATE SET stripe_account_id = EXCLUDED.stripe_account_id
		`, in.AuthorID, stripeAccountID)
		if err != nil {
			s.log.Error("connect_account_insert_failed", zap.Error(err))
			return "", utils.Internal("Failed to store Connect account", err)
		}
	} else if err != nil {
		return "", utils.Internal("Failed to lookup Connect account", err)
	}

	// 3. Create account link
	origins := s.cfg.CORSOriginsList()
	baseURL := "http://localhost:3000"
	if len(origins) > 0 {
		baseURL = origins[0]
	}

	linkParams := &stripe.AccountLinkParams{
		Account:    stripe.String(stripeAccountID),
		RefreshURL: stripe.String(baseURL + "/wallet/connect/refresh"),
		ReturnURL:  stripe.String(baseURL + "/wallet/connect/return"),
		Type:       stripe.String("account_onboarding"),
	}
	link, err := accountlink.New(linkParams)
	if err != nil {
		s.log.Error("account_link_create_failed", zap.Error(err))
		return "", utils.ServiceUnavailable("Failed to create onboarding link", "STRIPE_ERROR")
	}

	return link.URL, nil
}

// GetStatus returns the current Connect status for an author.
func (s *ConnectService) GetStatus(ctx context.Context, authorID string) (*ConnectStatus, error) {
	var (
		status             string
		chargesEnabled     bool
		payoutsEnabled     bool
		detailsSubmitted   bool
		requirementsDueRaw []byte
		lastSync           time.Time
	)
	err := s.db.QueryRow(ctx, `
		SELECT status, charges_enabled, payouts_enabled, details_submitted,
		       requirements_due, COALESCE(last_stripe_sync_at, now())
		FROM author_connect_accounts
		WHERE author_id = $1
	`, authorID).Scan(&status, &chargesEnabled, &payoutsEnabled, &detailsSubmitted, &requirementsDueRaw, &lastSync)

	if err == pgx.ErrNoRows {
		return &ConnectStatus{
			Status:           "not_onboarded",
			ChargesEnabled:   false,
			PayoutsEnabled:   false,
			DetailsSubmitted: false,
			RequirementsDue:  []string{},
		}, nil
	}
	if err != nil {
		return nil, utils.Internal("Failed to load Connect status", err)
	}

	// Refresh from Stripe if stale (> 5 min)
	if time.Since(lastSync) > 5*time.Minute {
		go s.refreshFromStripe(context.Background(), authorID)
	}

	requirementsDue := []string{}
	if len(requirementsDueRaw) > 0 {
		_ = json.Unmarshal(requirementsDueRaw, &requirementsDue)
	}

	return &ConnectStatus{
		Status:           status,
		ChargesEnabled:   chargesEnabled,
		PayoutsEnabled:   payoutsEnabled,
		DetailsSubmitted: detailsSubmitted,
		RequirementsDue:  requirementsDue,
	}, nil
}

// refreshFromStripe fetches the latest status from Stripe.
func (s *ConnectService) refreshFromStripe(ctx context.Context, authorID string) {
	var stripeAccountID string
	err := s.db.QueryRow(ctx,
		`SELECT stripe_account_id FROM author_connect_accounts WHERE author_id = $1`,
		authorID,
	).Scan(&stripeAccountID)
	if err != nil {
		return
	}

	acct, err := s.stripe.Accounts.GetByID(stripeAccountID, nil)
	if err != nil {
		s.log.Warn("stripe_account_fetch_failed",
			zap.Error(err),
			zap.String("account_id", stripeAccountID),
		)
		return
	}

	status := "pending"
	if acct.ChargesEnabled && acct.PayoutsEnabled {
		status = "active"
	} else if len(acct.Requirements.CurrentlyDue) > 0 {
		status = "restricted"
	}

	reqJSON, _ := json.Marshal(acct.Requirements.CurrentlyDue)

	_, err = s.db.Exec(ctx, `
		UPDATE author_connect_accounts
		SET status = $1, charges_enabled = $2, payouts_enabled = $3,
		    details_submitted = $4, requirements_due = $5,
		    last_stripe_sync_at = now(), updated_at = now()
		WHERE author_id = $6
	`,
		status, acct.ChargesEnabled, acct.PayoutsEnabled, acct.DetailsSubmitted,
		reqJSON, authorID,
	)
	if err != nil {
		s.log.Error("connect_status_update_failed", zap.Error(err))
	}
}

// SyncFromWebhook is called by the Stripe webhook handler for
// `account.updated` events.
func (s *ConnectService) SyncFromWebhook(ctx context.Context, stripeAccountID string) error {
	acct, err := s.stripe.Accounts.GetByID(stripeAccountID, nil)
	if err != nil {
		return fmt.Errorf("fetch account: %w", err)
	}

	status := "pending"
	if acct.ChargesEnabled && acct.PayoutsEnabled {
		status = "active"
	} else if len(acct.Requirements.CurrentlyDue) > 0 {
		status = "restricted"
	}

	reqJSON, _ := json.Marshal(acct.Requirements.CurrentlyDue)

	_, err = s.db.Exec(ctx, `
		UPDATE author_connect_accounts
		SET status = $1, charges_enabled = $2, payouts_enabled = $3,
		    details_submitted = $4, requirements_due = $5,
		    last_stripe_sync_at = now(), updated_at = now()
		WHERE stripe_account_id = $6
	`,
		status, acct.ChargesEnabled, acct.PayoutsEnabled, acct.DetailsSubmitted,
		reqJSON, stripeAccountID,
	)
	return err
}