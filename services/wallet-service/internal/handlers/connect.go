package handlers

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/wallet-service/internal/config"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/services"
	"github.com/talvoapp/universal-publishing/wallet-service/internal/utils"
)

// ConnectHandler handles Stripe Connect onboarding.
type ConnectHandler struct {
	cfg     *config.Config
	service *services.ConnectService
	log     *zap.Logger
}

// NewConnectHandler creates a Connect handler.
func NewConnectHandler(cfg *config.Config, db *pgxpool.Pool, stripe *client.API, log *zap.Logger) *ConnectHandler {
	return &ConnectHandler{
		cfg:     cfg,
		service: services.NewConnectService(cfg, db, stripe, log),
		log:     log,
	}
}

// Onboard creates or refreshes a Connect onboarding link.
//
//	POST /api/v1/wallet/connect/onboard
//
// Returns: { "url": "https://connect.stripe.com/..." }
// The user is redirected to this URL to complete onboarding.
func (h *ConnectHandler) Onboard(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	url, err := h.service.GetOnboardingURL(r.Context(), services.OnboardingInput{
		AuthorID: user.ID,
		Email:    user.Email,
	})
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"url": url})
}

// Status returns the current Connect status.
//
//	GET /api/v1/wallet/connect/status
//
// Response:
//
//	{
//	  "status": "active",
//	  "chargesEnabled": true,
//	  "payoutsEnabled": true,
//	  "detailsSubmitted": true,
//	  "requirementsDue": []
//	}
func (h *ConnectHandler) Status(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	status, err := h.service.GetStatus(r.Context(), user.ID)
	if err != nil {
		writeError(w, r, err)
		return
	}

	writeJSON(w, http.StatusOK, status)
}