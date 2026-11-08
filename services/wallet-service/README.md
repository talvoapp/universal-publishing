# Wallet Service

Author balance + payout microservice for **Universal Publishing Platform**.

Maintains a strict **double-entry ledger** and manages **Stripe Connect** payouts. Consumes Kafka events from marketplace-service to credit authors on each sale, and handles author-initiated withdrawals to their bank accounts.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Ledger** | Immutable double-entry bookkeeping (debit/credit) |
| **Balances** | Derive author available balance from ledger |
| **Payouts** | Author-initiated withdrawals via Stripe Connect |
| **Connect** | Stripe Connect Express account onboarding |
| **Analytics** | Gross revenue, platform fees, net earnings per author |
| **Events** | Consume `OrderPaid` + `RefundIssued` from Kafka |

---

## 🏗️ Architecture

```
        ┌─────────────┐
        │  Kafka      │ (from marketplace-service)
        │  OrderPaid  │
        │  RefundIssued│
        └──────┬──────┘
               │
        ┌──────▼──────────┐
        │ wallet-service  │
        │ (consumer + HTTP│
        │   + ledger)     │
        └──────┬──────────┘
               │
       ┌───────┼──────────┐
       │       │          │
  ┌────▼───┐ ┌─▼───┐ ┌──▼─────┐
  │Postgres│ │Redis│ │Stripe  │
  │wallet_ │ │DB 6 │ │Connect │
  │db      │ └─────┘ │API     │
  └────────┘         └────────┘
```

**Databases:**
- **PostgreSQL** (`wallet_db`): `ledger_transactions`, `ledger_entries`, `processed_events`, `payouts`, `author_connect_accounts`
- **Redis** (db 6): idempotency keys, rate limits
- **Kafka**: consumes `OrderPaid` + `RefundIssued`

---

## 📚 Double-Entry Ledger Model

Every money movement posts a **transaction** with multiple **entries**.
The invariant enforced at write time:

```
sum(entry.debit) == sum(entry.credit)
```

### Accounts

| Type | Key | Meaning |
|---|---|---|
| `author` | `{author_id}` | Individual author's wallet |
| `platform` | `revenue` | Gross platform revenue |
| `platform` | `fees` | Platform commission (15% by default) |
| `platform` | `payouts_clearing` | Money in transit to authors |
| `tax` | `collected` | Tax held for remittance |

### Example: OrderPaid ($12.99 subtotal, $1.04 tax, $1.95 fee, $11.04 author)

```
Debit   platform:revenue           $14.03
Credit  author:{author_id}         $11.04
Credit  platform:fees              $1.95
Credit  tax:collected              $1.04
─────────────────────────────────────────
Total   debits = $14.03 = total credits  ✓
```

### Example: RefundIssued (reversing)

```
Debit   author:{author_id}         $11.04
Debit   platform:fees              $1.95
Debit   tax:collected              $1.04
Credit  platform:revenue           $14.03
─────────────────────────────────────────
```

Balances are computed on-demand:

```sql
SELECT SUM(credit - debit) FROM ledger_entries
WHERE account_type = 'author' AND account_key = $author_id
```

Positive → author has withdrawable balance.
Negative → author owes platform (rare, post-refund edge case).

---

## 📡 API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Wallet

| Method | Path | Notes |
|---|---|---|
| `GET` | `/wallet` | Current balance summary |
| `GET` | `/wallet/ledger?limit=&cursor=` | Paginated ledger entries |
| `GET` | `/wallet/analytics?period=30d` | Revenue chart |

### Payouts

| Method | Path | Notes |
|---|---|---|
| `POST` | `/wallet/payouts/request` | Request a payout |
| `GET` | `/wallet/payouts` | List my payouts |

### Connect

| Method | Path | Notes |
|---|---|---|
| `POST` | `/wallet/connect/onboard` | Get onboarding URL |
| `GET` | `/wallet/connect/status` | Check onboarding status |

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/ready` |
| `GET` | `/metrics` |

---

## 🔐 Security Model

### Idempotency

Every event consumed from Kafka is checked against `processed_events`:

- If `event_id` already exists → skip (already processed)
- Insertion of `processed_event` happens in the same DB transaction as the ledger entries
- Unique constraint on `event_id` prevents concurrent double-processing

### Ledger invariants

- **`CHECK ((debit = 0) <> (credit = 0))`** — DB-level: exactly one of debit/credit is non-zero per entry
- **`debit >= 0 AND credit >= 0`** — no negative amounts
- **`sum(debit) == sum(credit)`** — validated at app level AND via the DB trigger (future)
- **Immutable** — entries are never updated or deleted

### Payout validation

Before Stripe transfer:
1. Amount within `[PAYOUT_MINIMUM_CENTS, PAYOUT_MAXIMUM_CENTS]`
2. Connect account is `active` and `payouts_enabled`
3. Author's available balance >= requested amount
4. Ledger debit posted BEFORE Stripe call (prevents double-spend)
5. On Stripe failure: compensating ledger transaction reverses the debit

### Connect

- Stripe Connect Express accounts (`type=express`)
- `individual` business type (most authors are individuals)
- Webhook `account.updated` syncs status in real time
- Status cached for 5 minutes, refreshed on-demand

---

## 🔄 Event Flow

### OrderPaid → Author credit

1. Kafka message arrives on `upp.outbox.events`
2. Consumer checks `processed_events` for idempotency
3. `PostTransaction` validates + inserts 4 ledger entries atomically
4. `processed_events` row inserted (same transaction)
5. Offset committed

### RefundIssued → Reversal

Same flow, but with reversing entries. Balance may go negative
(standard accounting practice — author owes platform until next sale).

---

## 🚀 Running Locally

### Prerequisites

- Go 1.22+
- PostgreSQL 16 (with `wallet_db` created)
- Redis 7 (db 6)
- Kafka 3+

Or use Docker Compose from the repo root:

```bash
docker compose up -d postgres redis kafka
```

### Setup

```bash
cd services/wallet-service
cp .env.example .env
# Edit .env with real Stripe test keys

# Run migrations
make migrate

# Start dev (hot reload via air)
make dev
```

Listens on `http://localhost:4005`.

### Stripe webhooks

```bash
stripe listen --forward-to http://localhost:4005/webhooks/stripe
```

*(Note: wallet-service doesn't handle Stripe webhooks directly in v1 — Connect status is refreshed on-demand. Add webhook forwarding when implementing `account.updated` handling.)*

---

## 🧪 Testing

```bash
# Unit tests (no external deps)
go test ./...

# Integration tests (requires Postgres + Redis)
go test -tags=integration -v ./tests/...

# With race detector
go test -race ./...

# Coverage
make test-cover
```

---

## 📦 Docker

```bash
docker build -t upp/wallet-service:latest .
docker run --env-file .env.production -p 4005:4005 upp/wallet-service:latest
```

**Image size**: ~15 MB (static binary on `scratch`).

---

## 📁 Directory Structure

```
cmd/
└── main.go                Bootstrap (config, DB, Redis, Stripe, consumer, server)

internal/
├── config/                Env loading + validation
├── server/                HTTP server + router + graceful shutdown
├── middleware/            RequestID, auth, error, rate limit
├── handlers/              HTTP handlers (wallet, ledger, payout, connect, analytics)
├── services/              Business logic (connect, payout, analytics)
├── ledger/                Double-entry core (validate, post, balance)
├── models/                DB row structs
├── consumer/              Kafka consumer (OrderPaid, RefundIssued)
├── db/                    PostgreSQL + Redis helpers + migrations
└── utils/                 Logger + errors
```

---

## 🩺 Debugging

**"Insufficient balance" on payout despite showing money**
→ Balance is `sum(credit) - sum(debit)`. A recent refund might have debited your account. Check `/wallet/ledger`.

**"Connect account is restricted"**
→ The author needs to complete onboarding requirements. Check `/wallet/connect/status` for `requirementsDue`.

**Kafka consumer stuck**
→ Check `processed_events` — if an event is stuck there, its transaction was rolled back but the record persisted (shouldn't happen due to atomicity; check DB constraints).

**Duplicate OrderPaid**
→ Verify `processed_events` unique constraint exists:
```sql
\d processed_events
```

---

## 📝 License

Proprietary — All rights reserved.