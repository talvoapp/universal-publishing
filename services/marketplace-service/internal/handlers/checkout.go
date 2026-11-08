package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v76"
	"github.com/stripe/stripe-go/v76/client"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/config"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/middleware"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/outbox"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/services"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// CheckoutHandler handles purchase initiation + confirmation.
type CheckoutHandler struct {
	cfg       *config.Config
	db        *pgxpool.Pool
	redis     *redis.Client
	stripeSvc *services.StripeService
	taxSvc    *services.TaxService
	publisher *outbox.Publisher
	log       *zap.Logger
}

// NewCheckoutHandler creates a checkout handler.
func NewCheckoutHandler(
	cfg *config.Config,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	stripe *client.API,
	pub *outbox.Publisher,
	log *zap.Logger,
) *CheckoutHandler {
	return &CheckoutHandler{
		cfg:       cfg,
		db:        pool,
		redis:     rdb,
		stripeSvc: services.NewStripeService(stripe, cfg.StripePublishableKey),
		taxSvc:    services.NewTaxService(stripe),
		publisher: pub,
		log:       log,
	}
}

// InitiateRequest is the POST body for initiating checkout.
type InitiateRequest struct {
	ItemID     string   `json:"itemId"`
	ChapterIDs []string `json:"chapterIds,omitempty"`
	Country    string   `json:"country,omitempty"`
	State      string   `json:"state,omitempty"`
	PostalCode string   `json:"postalCode,omitempty"`
	SuccessURL string   `json:"successUrl"`
	CancelURL  string   `json:"cancelUrl"`
}

// Initiate creates a Stripe Checkout Session and stores a pending order.
//
//	POST /api/v1/market/checkout
func (h *CheckoutHandler) Initiate(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	var req InitiateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, utils.BadRequest("Invalid request body", "INVALID_BODY"))
		return
	}

	// Validate
	itemID, err := uuid.Parse(req.ItemID)
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid itemId", "INVALID_ITEM_ID"))
		return
	}
	if req.SuccessURL == "" || req.CancelURL == "" {
		writeError(w, r, utils.BadRequest("successUrl and cancelUrl required", "MISSING_URLS"))
		return
	}

	// Fetch item
	item, err := h.fetchItem(r.Context(), itemID)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if !item.IsPublished {
		writeError(w, r, utils.NotFound("Item not available", "ITEM_NOT_AVAILABLE"))
		return
	}

	// Compute subtotal
	var chapterIDs []uuid.UUID
	subtotalCents := item.PriceCents
	if item.PricingModel == models.PricingPayPerChapter {
		var chapters []models.Chapter
		for _, chStr := range req.ChapterIDs {
			chID, err := uuid.Parse(chStr)
			if err != nil {
				writeError(w, r, utils.BadRequest("Invalid chapterId", "INVALID_CHAPTER_ID"))
				return
			}
			chapterIDs = append(chapterIDs, chID)
		}
		chapters, err = h.fetchChapters(r.Context(), chapterIDs)
		if err != nil {
			writeError(w, r, err)
			return
		}
		subtotalCents = 0
		for _, ch := range chapters {
			price, paid := item.PriceFor(&ch)
			if paid {
				subtotalCents += price.Mul(decimal.NewFromInt(100)).IntPart()
			}
		}
	}
	if subtotalCents <= 0 {
		writeError(w, r, utils.BadRequest("Nothing to purchase", "EMPTY_CART"))
		return
	}

	// Compute tax
	taxResult, err := h.taxSvc.Calculate(r.Context(), services.TaxCalculationInput{
		Currency:        item.Currency,
		AmountCents:     subtotalCents,
		CustomerCountry: req.Country,
		CustomerState:   req.State,
		CustomerPostal:  req.PostalCode,
		ProductTaxCode:  "txcd_10000000",
	})
	if err != nil {
		h.log.Warn("tax_calc_failed", zap.Error(err))
		writeError(w, r, utils.ServiceUnavailable("Tax calculation failed", "TAX_FAILED"))
		return
	}

	// Compute fees
	platformFeeCents := int64(float64(subtotalCents) * (h.cfg.PlatformFeePercent / 100.0))
	authorEarningsCents := subtotalCents - platformFeeCents
	totalCents := subtotalCents + taxResult.TaxCents

	// Create order
	orderID := uuid.New()
	now := time.Now()

	_, err = h.db.Exec(r.Context(), `
		INSERT INTO orders (
			id, buyer_id, item_id, author_id, chapter_ids, quantity, currency,
			subtotal, tax_amount, platform_fee, author_earnings, total,
			status, created_at, updated_at, metadata
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
	`,
		orderID, user.ID, item.ID, item.AuthorID, chapterIDs, 1, item.Currency,
		centsToDecimal(subtotalCents), centsToDecimal(taxResult.TaxCents),
		centsToDecimal(platformFeeCents), centsToDecimal(authorEarningsCents),
		centsToDecimal(totalCents),
		string(models.OrderPending), now, now,
		map[string]any{"tax_jurisdiction": taxResult.Jurisdiction},
	)
	if err != nil {
		h.log.Error("order_insert_failed", zap.Error(err))
		writeError(w, r, utils.Internal("Could not create order", err))
		return
	}

	// Create Stripe Checkout Session
	successURL := req.SuccessURL + "?order_id=" + orderID.String() + "&session_id={CHECKOUT_SESSION_ID}"
	cancelURL := req.CancelURL + "?order_id=" + orderID.String()

	sess, err := h.stripeSvc.CreateCheckoutSession(r.Context(), services.CheckoutSessionInput{
		Mode: "payment",
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
					Currency: stripe.String(item.Currency),
					ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
						Name:        stripe.String(item.Title),
						Description: stripe.String(item.Description),
					},
					UnitAmount: stripe.Int64(totalCents),
				},
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL:        successURL,
		CancelURL:         cancelURL,
		CustomerEmail:     user.Email,
		ClientReferenceID: orderID.String(),
		Metadata: map[string]string{
			"order_id":    orderID.String(),
			"buyer_id":    user.ID,
			"item_id":     item.ID.String(),
			"author_id":   item.AuthorID.String(),
			"idempotency": r.Header.Get("Idempotency-Key"),
		},
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.log.Error("stripe_session_failed", zap.Error(err))
		_, _ = h.db.Exec(r.Context(), `DELETE FROM orders WHERE id = $1`, orderID)
		writeError(w, r, utils.ServiceUnavailable("Payment provider unavailable", "STRIPE_UNAVAILABLE"))
		return
	}

	// Persist Stripe session ID
	_, _ = h.db.Exec(r.Context(), `
		UPDATE orders SET stripe_checkout_id = $1 WHERE id = $2
	`, sess.ID, orderID)

	writeJSON(w, http.StatusCreated, map[string]any{
		"order_id":         orderID.String(),
		"checkout_url":     sess.URL,
		"checkout_session": sess.ID,
		"subtotal_cents":   subtotalCents,
		"tax_cents":        taxResult.TaxCents,
		"total_cents":      totalCents,
		"currency":         item.Currency,
		"tax_jurisdiction": taxResult.Jurisdiction,
	})
}

// ConfirmRequest is the POST body for confirming a checkout.
type ConfirmRequest struct {
	SessionID string `json:"sessionId"`
}

// Confirm reconciles an order after the frontend returns from Stripe.
//
//	POST /api/v1/market/checkout/:checkoutID/confirm
func (h *CheckoutHandler) Confirm(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		writeError(w, r, utils.Unauthorized("Not authenticated", "UNAUTHORIZED"))
		return
	}

	orderID, err := uuid.Parse(chi.URLParam(r, "checkoutID"))
	if err != nil {
		writeError(w, r, utils.BadRequest("Invalid checkout ID", "INVALID_ID"))
		return
	}

	row := h.db.QueryRow(r.Context(), `
		SELECT id, status, stripe_payment_intent_id, total, currency
		FROM orders
		WHERE id = $1 AND buyer_id = $2
	`, orderID, user.ID)

	var id uuid.UUID
	var status string
	var piID *string
	var total decimal.Decimal
	var currency string
	err = row.Scan(&id, &status, &piID, &total, &currency)
	if err != nil {
		writeError(w, r, utils.NotFound("Order not found", "ORDER_NOT_FOUND"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"order_id":     id.String(),
		"status":       status,
		"total":        total,
		"currency":     currency,
		"payment_done": status == string(models.OrderSucceeded),
	})
}

// ------------------------------------------------------------
// DB helpers
// ------------------------------------------------------------
func (h *CheckoutHandler) fetchItem(ctx context.Context, id uuid.UUID) (*models.Item, error) {
	row := h.db.QueryRow(ctx, `
		SELECT id, draft_id, author_id, type, pricing_model, title, description,
		       cover_url, language, tags, price_cents, currency, free_chapters,
		       is_published, word_count, read_minutes, created_at, updated_at
		FROM items WHERE id = $1
	`, id)
	var it models.Item
	err := row.Scan(
		&it.ID, &it.DraftID, &it.AuthorID, &it.Type, &it.PricingModel,
		&it.Title, &it.Description, &it.CoverURL, &it.Language, &it.Tags,
		&it.PriceCents, &it.Currency, &it.FreeChapters,
		&it.IsPublished, &it.WordCount, &it.ReadMinutes,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		return nil, utils.NotFound("Item not found", "ITEM_NOT_FOUND")
	}
	return &it, nil
}

func (h *CheckoutHandler) fetchChapters(ctx context.Context, ids []uuid.UUID) ([]models.Chapter, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := h.db.Query(ctx, `
		SELECT id, item_id, index, title, price_cents, word_count,
		       content_published, created_at, updated_at
		FROM chapters WHERE id = ANY($1)
	`, ids)
	if err != nil {
		return nil, utils.Internal("Failed to load chapters", err)
	}
	defer rows.Close()

	var chapters []models.Chapter
	for rows.Next() {
		var c models.Chapter
		if err := rows.Scan(&c.ID, &c.ItemID, &c.Index, &c.Title, &c.PriceCents, &c.WordCount, &c.ContentPublished, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, utils.Internal("Scan chapter failed", err)
		}
		chapters = append(chapters, c)
	}
	return chapters, nil
}

// centsToDecimal converts cents (int64) to a decimal amount in dollars.
func centsToDecimal(cents int64) decimal.Decimal {
	return decimal.NewFromInt(cents).Div(decimal.NewFromInt(100))
}