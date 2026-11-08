# Notification Service

Event-driven notification dispatcher for **Universal Publishing Platform**.

Consumes Kafka events and dispatches notifications via **email** (SMTP), **in-app** (Postgres inbox), and **push** (FCM stub — v2).

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **OrderPaid** | Order confirmation email + in-app |
| **DraftPublished** | New-post notifications to followers (capped at 1000) |
| **PayoutCompleted** | Payout confirmation email + in-app |
| **ConnectStatusChanged** | Stripe Connect onboarding status updates |
| **Idempotency** | `processed_events` table + Redis dedup |
| **Rate limiting** | Per-recipient email limits (100/hour) |

---

## 🏗️ Architecture

```
        ┌──────────────┐
        │  Kafka       │  upp.outbox.events
        └──────┬───────┘
               │
        ┌──────▼────────────┐
        │ notification-     │
        │ service           │  (Kafka consumer + HTTP health)
        └───┬────┬──────┬───┘
            │    │      │
     ┌──────┘    │      └──────┐
     │           │             │
┌────▼────┐ ┌────▼────┐ ┌──────▼─────┐
│Postgres │ │ Redis   │ │ SMTP       │
│notif.   │ │ DB 6    │ │ (Mailhog)  │
└─────────┘ └─────────┘ └────────────┘
```

**The service has NO user-facing API.** Only `/health`, `/ready`, `/metrics`.

---

## 📥 Events consumed

### OrderPaid
Triggered when a purchase completes.

**Actions:**
- Email confirmation to buyer (template: `order-confirmation`)
- In-app notification

### DraftPublished
Triggered when an author publishes.

**Actions:**
- In-app notification to each follower
- Email (rate-limited) — capped at 1000 recipients per event

### PayoutCompleted
Triggered when an author payout succeeds.

**Actions:**
- Email confirmation (template: `payout-sent`)
- In-app notification

### ConnectStatusChanged
Triggered when a Stripe Connect account status changes.

**Actions:**
- In-app notification
- Email only for `active` or `restricted` status

---

## 🔐 Idempotency

Every event is deduplicated:

1. **Postgres** — `processed_events` table with unique `event_id`
2. **Redis** — per-recipient, per-channel dedup key with 24h TTL
3. **DB unique index** — `notifications(idempotency_key)` as final safety

**Key principle**: the idempotency key is reserved **AFTER** the notification is successfully sent/delivered, never before. Failed sends can be retried.

---

## 📧 Email delivery

**Templates** live in `src/templates/`:
- `{name}.subject.hbs` — email subject
- `{name}.html.hbs` — HTML body (wrapped in `layouts/base.hbs`)
- `{name}.text.hbs` — optional plain-text version

**Error classification:**
- `TransientError` → Kafka retries (SMTP timeout, network)
- `PermanentError` → mark processed, no retry (invalid email, bounced)

**Rate limiting:** 100 emails/hour per recipient (Redis counter).

---

## 🚀 Running Locally

```bash
cd services/notification-service
cp .env.example .env
npm install
npm run dev
```

Requires:
- PostgreSQL (`notifications_db` created + migrations applied)
- Redis (db 6)
- Kafka
- Mailhog (SMTP) — `docker compose up mailhog`

View emails at http://localhost:8025 (Mailhog UI).

---

## 🧪 Testing

```bash
npm test           # Jest
npm run typecheck  # TypeScript check
```

---

## 📦 Docker

```bash
docker build -t upp/notification-service:latest .
docker run --env-file .env.production -p 4008:4008 upp/notification-service:latest
```

**Note on templates**: the Dockerfile copies `src/templates` → `dist/templates` explicitly (TypeScript doesn't bundle `.hbs` files).

---

## 📁 Directory Structure

```
src/
├── index.ts            Bootstrap
├── app.ts              Express factory (health only)
├── config.ts           Env validation
├── consumers/          Kafka loop + event handlers
│   ├── consumer.ts
│   ├── order_paid.ts
│   ├── book_published.ts
│   ├── payout_completed.ts
│   └── connect_status.ts
├── handlers/           Channel dispatchers
│   ├── email.handler.ts
│   └── inapp.handler.ts
├── services/           Business logic
│   ├── template.service.ts
│   └── push.service.ts (stub)
├── templates/          Handlebars templates
│   ├── layouts/base.hbs
│   └── *.subject.hbs, *.html.hbs, *.text.hbs
├── db/                 Postgres + Redis
└── utils/              Logger, Sentry, Errors
```

---

## 🩺 Debugging

**Emails not arriving**
- Check Mailhog: http://localhost:8025
- Check logs for `email_sent` or `email_transient_failure`
- Check `processed_events` — event might be marked done (skip on retry)

**`/ready` returns 503**
- Check which dependency failed: `{"postgres":"fail"}` etc.
- If `kafka_consumer: fail` → consumer crashed, check logs for `consumer_error`

**Duplicate notifications**
- Check Redis key `notify:inapp:idem:{key}` — should exist after first send
- Check `notifications` table for duplicate `idempotency_key` (shouldn't happen due to unique index)

**Email rate limit hit**
- Check Redis: `redis-cli -n 6 GET "notify:email-rate:{userId}"`
- Reset: `redis-cli -n 6 DEL "notify:email-rate:{userId}"`

---

## 📝 License

Proprietary — All rights reserved.