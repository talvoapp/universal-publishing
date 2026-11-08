package handlers

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/services"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// AnalyticsHandler serves author revenue analytics.
type AnalyticsHandler struct {
	cfg     *config.Config
	service *services.AnalyticsService
	log     *zap.Logger
}

// NewAnalyticsHandler creates an analytics handler.
func NewAnalyticsHandler(cfg *config.Config, db *pgxpool.Pool, log *zap.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{
		cfg:     cfg,
		service: services.NewAnalyticsService(db, log),
		log:     log,
	}
}

// Get returns revenue analytics for the current author.
//
//	GET /api/v1/wallet/analytics?period=30d
//
// Response:
//
//	{
//	  "period": "30d",
//	  "currency": "USD",
//	  "grossRevenue": "1234.56",
//	  "platformFees": "185.18",
//	  "netEarnings": "1049.38",
//	  "saleCount": 42,
//	  "daily": [
//	    {"date": "2025-01-15", "amount": "45.00"},
//	    ...
//	  ]
//	}
func (h *AnalyticsHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "30d"
	}
	// Cap supported periods
	switch period {
	case "7d", "30d", "90d", "1y", "all":
	default:
		period = "30d"
	}

	result, err := h.service.GetAnalytics(r.Context(), services.AnalyticsInput{
		AuthorID: user.ID,
		Period:   period,
		Currency: "USD",
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}