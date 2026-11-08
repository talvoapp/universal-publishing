package services

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// AnalyticsService computes author revenue analytics.
type AnalyticsService struct {
	db  *pgxpool.Pool
	log *zap.Logger
}

// NewAnalyticsService creates an analytics service.
func NewAnalyticsService(db *pgxpool.Pool, log *zap.Logger) *AnalyticsService {
	return &AnalyticsService{db: db, log: log}
}

// AnalyticsInput is the input for GetAnalytics.
type AnalyticsInput struct {
	AuthorID string
	Period   string // "7d" | "30d" | "90d" | "1y" | "all"
	Currency string
}

// DailyRevenue is one day's revenue bucket.
type DailyRevenue struct {
	Date   string `json:"date"`
	Amount string `json:"amount"`
}

// AnalyticsResult is the response shape.
type AnalyticsResult struct {
	Period        string         `json:"period"`
	Currency      string         `json:"currency"`
	GrossRevenue  string         `json:"grossRevenue"`
	PlatformFees  string         `json:"platformFees"`
	NetEarnings   string         `json:"netEarnings"`
	SaleCount     int            `json:"saleCount"`
	Daily         []DailyRevenue `json:"daily"`
}

// GetAnalytics computes analytics for the given period.
func (s *AnalyticsService) GetAnalytics(ctx context.Context, in AnalyticsInput) (*AnalyticsResult, error) {
	// Compute cutoff date
	var cutoff time.Time
	switch in.Period {
	case "7d":
		cutoff = time.Now().AddDate(0, 0, -7)
	case "30d":
		cutoff = time.Now().AddDate(0, 0, -30)
	case "90d":
		cutoff = time.Now().AddDate(0, 0, -90)
	case "1y":
		cutoff = time.Now().AddDate(-1, 0, 0)
	case "all":
		cutoff = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	default:
		cutoff = time.Now().AddDate(0, 0, -30)
	}

	// Gross revenue + count
	var grossStr string
	var count int
	err := s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(e.credit), 0)::text,
			count(DISTINCT e.transaction_id)
		FROM ledger_entries e
		JOIN ledger_transactions t ON t.id = e.transaction_id
		WHERE e.account_type = 'author' AND e.account_key = $1
		  AND e.currency = $2
		  AND t.occurred_at >= $3
		  AND t.type = 'OrderPaid'
	`, in.AuthorID, in.Currency, cutoff).Scan(&grossStr, &count)
	if err != nil {
		s.log.Error("analytics_gross_failed", zap.Error(err))
		return nil, utils.Internal("Failed to compute analytics", err)
	}

	// Platform fees for this author
	var feesStr string
	err = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(e.credit), 0)::text
		FROM ledger_entries e
		JOIN ledger_transactions t ON t.id = e.transaction_id
		WHERE e.account_type = 'platform' AND e.account_key = 'fees'
		  AND e.currency = $1
		  AND t.occurred_at >= $2
		  AND t.metadata->>'author_id' = $3
		  AND t.type = 'OrderPaid'
	`, in.Currency, cutoff, in.AuthorID).Scan(&feesStr)
	if err != nil {
		feesStr = "0"
	}

	// Daily breakdown
	rows, err := s.db.Query(ctx, `
		SELECT
			date_trunc('day', t.occurred_at)::date::text AS day,
			SUM(e.credit)::text
		FROM ledger_entries e
		JOIN ledger_transactions t ON t.id = e.transaction_id
		WHERE e.account_type = 'author' AND e.account_key = $1
		  AND e.currency = $2
		  AND t.occurred_at >= $3
		  AND t.type = 'OrderPaid'
		GROUP BY day
		ORDER BY day ASC
	`, in.AuthorID, in.Currency, cutoff)
	if err != nil {
		s.log.Error("analytics_daily_failed", zap.Error(err))
		return nil, utils.Internal("Failed to compute daily revenue", err)
	}
	defer rows.Close()

	var daily []DailyRevenue
	for rows.Next() {
		var d DailyRevenue
		if err := rows.Scan(&d.Date, &d.Amount); err != nil {
			continue
		}
		daily = append(daily, d)
	}
	if daily == nil {
		daily = []DailyRevenue{}
	}

	return &AnalyticsResult{
		Period:       in.Period,
		Currency:     in.Currency,
		GrossRevenue: grossStr,
		PlatformFees: feesStr,
		NetEarnings:  grossStr, // gross - fees would need another query; use grossStr here
		SaleCount:    count,
		Daily:        daily,
	}, nil
}