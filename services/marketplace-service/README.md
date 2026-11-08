# Marketplace Service

E-commerce + payments microservice for **Universal Publishing Platform**.

Handles catalog browsing, purchase checkout, subscriptions, refunds, and Stripe webhooks. Writes money movement events to Kafka via the transactional outbox pattern.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Catalog** | List/get published items (books, articles, news channels) |
| **Checkout** | Stripe Checkout Session creation (one-time purchases) |
| **Subscriptions** | Recurring billing for authors / news channels |
| **Refunds** | Full or partial refunds with compensating ledger events |
| **Webhooks** | Stripe event ingestion with signature verification |
| **Outbox** | Reliable event publishing via Kafka |

---

## 🏗️ Architecture

```
       ┌────────────────┐
       │  Nginx Gateway │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │ marketplace    │
       │  (this service)│
       └───┬────┬────┬──┘
           │    │    │
    ┌──────┘    │    └────────┐
    │           │             │
┌───▼───┐  ┌────▼───┐  ┌─────▼─────┐
│Postgres│ │ Redis  │  │  Stripe   │
│market_ │ │ DB 3   │  │  (API)    │
└────┬───┘  └────────┘  └───────────┘
     │
┌────▼────────┐
│Outbox table │ (relay picks up → Kafka)
└────┬────────┘
     │
┌────▼────┐
│  Kafka  │ (upp.outbox.events)
└─────────┘
```

**Databases:**
- **PostgreSQL** (`marketplace_db`): `items`, `chapters`, `orders`, `subscriptions`, `outbox`
- **Redis** (db 3): idempotency keys, rate limits, webhook dedup
- **Kafka**: publishes `OrderPaid`, `RefundIssued`, `SubscriptionCanceled` events

---

## 📡 API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Catalog

| Method | Path | Notes |
|---|---|---|
| `GET` | `/market/items?type=&limit=&cursor=` | List published items |
| `GET` | `/market/items/:itemID` | Get item details |
| `GET` | `/market/items/:itemID/chapters` | List chapters |

### Checkout

| Method | Path | Notes |
|---|---|---|
| `POST` | `/market/checkout` | Initiate purchase — requires `Idempotency-Key` |
| `POST` | `/market/checkout/:checkoutID/confirm` | Confirm after Stripe redirect |

### Subscriptions

| Method | Path | Notes |
|---|---|---|
| `POST` | `/market/subscriptions` | Create subscription |
| `GET` | `/market/subscriptions` | List my subscriptions |
| `DELETE` | `/market/subscriptions/:id` | Cancel (at period end) |

### Refunds

| Method | Path | Notes |
|---|---|---|
| `POST` | `/market/orders/:orderID/refund` | Admin, or author within 30 days |

### Webhooks

| Method | Path | Notes |
|---|---|---|
| `POST` | `/webhooks/stripe` | **Signature verified** — no auth header |

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/ready` |
| `GET` | `/metrics` |

---

## 🔐 Security Model

### Auth
- JWT (HS256) verified from `Authorization: Bearer` header
- Roles: `reader`, `author`, `editor`, `admin`
- Admin bypasses role checks

### Idempotency
- POST/PUT/PATCH with `Idempotency-Key` header: 24-hour cache
- Body-hash matched — mismatch → 422
- Concurrent same-key → 409 (in-progress)
- Successful responses replayed byte-for-byte

### Stripe
- Webhook signature verified before any processing
- Event dedup via Redis `SET NX` (24h)
- Idempotency keys passed to Stripe for payments + refunds

### Rate limits
- Global: 100/min per IP
- Checkout: 1/sec per user
- Refunds: (handled at handler level)

### Money handling
- All amounts stored as `NUMERIC(12,2)` — never float
- Use `shopspring/decimal` for computation
- Refunds go through Stripe, not direct DB edits

---

## 🔄 Outbox Pattern

Every payment state change:
1. Writes an `outbox` row in the SAME transaction as the order update
2. Relay picks it up (polling every 500ms)
3. Publishes to Kafka with at-least-once delivery
4. Marks row `published_at = now()`

Events emitted:
- `OrderPaid` → consumed by wallet-service (credit author's balance)
- `RefundIssued` → consumed by wallet-service (compensating entry)
- `SubscriptionCanceled` → consumed by notification-service

---

## 🚀 Running Locally

```bash
# Requires Postgres, Redis, Kafka running (see root docker-compose)
cd services/marketplace-service
cp .env.example .env
# Edit .env with real Stripe test keys

go mod download
go run ./cmd
```

Listens on `http://localhost:4004`.

### Stripe test webhooks

```bash
# In a separate terminal
stripe listen --forward-to http://localhost:4004/webhooks/stripe
# Note the printed webhook secret → update STRIPE_WEBHOOK_SECRET in .env
```

---

## 🧪 Testing

```bash
go test ./...
go test -race ./...
go test -cover ./...
```

---

## 📦 Docker

```bash
docker build -t upp/marketplace-service:latest .
docker run --env-file .env.production -p 4004:4004 upp/marketplace-service:latest
```

**Image size**: ~15 MB (static binary on `scratch`).

---

## 📁 Directory Structure

```
cmd/
└── main.go              Bootstrap (config, DB, Redis, Stripe, outbox, server)

internal/
├── config/              Env loading + validation
├── server/              HTTP server + router
├── middleware/          Auth, idempotency, rate-limit, error, RequestID
├── handlers/            HTTP handlers (catalog, checkout, subscription, refund, webhook)
├── services/            Business logic (stripe, tax, catalog, subscription, refund)
├── models/              DB row structs
├── db/                  PostgreSQL/Redis helpers + migrations
├── outbox/              Publisher + relay
└── utils/               Logger + errors
```

---

## 🩺 Debugging

**"webhook_signature_invalid"**
→ Ensure `STRIPE_WEBHOOK_SECRET` matches the one from `stripe listen` (local) or the Stripe Dashboard (production).

**"IDEMPOTENCY_MISMATCH"**
→ Two requests used the same `Idempotency-Key` with different bodies. Frontend bug — regenerate key per logical operation.

**Outbox events stuck**
→ Check `SELECT count(*) FROM outbox WHERE published_at IS NULL` — relay may be paused. Check Kafka connectivity.

**Order stuck in `pending`**
→ Stripe webhook not received. Check `stripe listen` output, or the webhook URL in Stripe Dashboard.

---

## 📝 License

Proprietary — All rights reserved.