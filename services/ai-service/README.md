# AI Service

AI writing assistant microservice for **Universal Publishing Platform**.

Provides streaming suggestions (grammar, rephrase, summarize, expand, generate) with:
- **Server-Sent Events (SSE)** streaming with resume support
- **Per-tier token quotas** (daily budgets in Redis)
- **Provider fallback** (OpenAI → Anthropic, configurable)
- **Client-side resume via sessionId** — no wasted provider calls on reconnect

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Streaming** | SSE endpoint with `chunk` / `usage` / `done` / `error` events |
| **Resume** | Same-session replay is idempotent (no duplicate provider charge) |
| **Quotas** | Free 5K, Premium 100K, Admin 1M tokens/day, reset at UTC midnight |
| **Fallback** | On provider failure, try configured fallback (if enabled) |
| **Rate limiting** | Per-user 2 req/s on `/suggest` (on top of quota) |

---

## 🏗️ Architecture

```
       ┌─────────────┐
       │ Nginx GW    │   X-Accel-Buffering: no (SSE-safe)
       └──────┬──────┘
              │
       ┌──────▼────────┐
       │ ai-service    │
       │ (HTTP + SSE)  │
       └──────┬────────┘
              │
      ┌───────┼────────────┐
      │       │            │
 ┌────▼───┐ ┌─▼────┐  ┌────▼──────────────┐
 │ Redis  │ │  SSE │  │ OpenAI / Anthropic│
 │ DB 2   │ │ state│  │ (per-provider SDK)│
 └────────┘ └──────┘  └───────────────────┘
```

- **No database** — everything is stateless except Redis (quotas + resume).
- **Conversations are ephemeral** — only token aggregates are stored.
- **Prompts/responses are never logged** (Pino redaction + Sentry scrub).

---

## 📡 API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Streaming

| Method | Path | Body |
|---|---|---|
| `POST` | `/ai/suggest` | `{ operation, selection, instruction?, tone?, sessionId? }` |

**Response:** `text/event-stream`

Event types:

```
event: chunk
data: {"delta":"hello","index":0}

event: usage
data: {"tokens_in":812,"tokens_out":120,"model":"gpt-4o","quota_remaining":4188}

event: done
data: {"session_id":"...","finish_reason":"stop"}

event: error
data: {"code":"ai_unavailable","retryable":true}
```

### Feedback & Quota

| Method | Path | Notes |
|---|---|---|
| `POST` | `/ai/feedback` | `{ sessionId, rating 1-5, comment? }` — free |
| `GET`  | `/quota` | returns `{ tier, limit, used, remaining, reset_at, at_warning }` |

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/ready` |

---

## 🔁 Resume Behavior

The `sessionId` parameter makes `/suggest` idempotent from the client's perspective:

| Server state | Behavior |
|---|---|
| No sessionId, no existing session | New stream (normal) |
| Existing session `completed` | Replay full text + `done(finish_reason=replay)` — **no new provider call** |
| Existing session `streaming` (active) | `409 SESSION_IN_USE` |
| Existing session `aborted` / `failed` | Replay prefix + new provider call (best-effort) |

This is safe from a billing perspective: replays never call the provider.

---

## 💰 Quotas

| Tier | Role | Daily limit |
|---|---|---|
| free | reader | 5,000 tokens |
| premium | author, editor | 100,000 tokens |
| admin | admin | 1,000,000 tokens |

- Counter: `ai:quota:{userId}:{YYYY-MM-DD}` (Redis, DB 2).
- TTL: 24 h (auto reset at UTC midnight, key changes at date boundary).
- **Atomic reserve** — `INCRBY` rejects over-limit requests before streaming.
- **Adjust after completion** — `recordActualUsage({reserved, actual})` prevents drift.

Warning header exposed: `X-AI-Quota-Warning` when usage ≥ 80%.

---

## 🔄 Provider Fallback

`config.providers.primary` = first attempt.
`config.providers.fallback` = second attempt (if enabled and configured).

Fallback triggers **only** on `ProviderUnavailableError` (5xx / timeout / rate limit).
Aborts and validation errors never trigger fallback.

If neither provider can serve, the stream ends with:

```
event: error
data: {"code":"ai_unavailable","retryable":true}
```

The client should retry with exponential backoff.

---

## 🚀 Running Locally

```bash
# 1. Install
npm install

# 2. Env — set at least one of OPENAI_API_KEY / ANTHROPIC_API_KEY
cp .env.example .env

# 3. Start
npm run dev
```

Listens on `http://localhost:4003`.

---

## 🧪 Testing

```bash
npm test           # once, with coverage
npm run test:ci    # CI mode
```

Tests use a real Redis (DB 2) but **mock the provider SDKs** — no network, no cost.

Coverage thresholds: 65% global, 80%+ on `quota.service.ts` and `fallback.service.ts`.

---

## 📦 Docker

```bash
docker build -t upp/ai-service:latest .
docker run --env-file .env.production -p 4003:4003 upp/ai-service:latest
```

Notes:
- **SSE requires no request timeout** — the Docker image sets none, and the Node server sets `requestTimeout = 0` programmatically in `index.ts`.
- **Graceful shutdown** — `tini` forwards SIGTERM; the service calls `closeAllStreams('server_shutting_down')` before closing, so every active stream gets an `error` frame with `retryable: true`.

---

## 📁 Directory Structure

```
src/
├── index.ts             Bootstrap + graceful shutdown
├── app.ts               Express factory (SSE-friendly headers)
├── config.ts            Zod-validated config (35 vars)
├── routes/              3 routers (ai, quota, index)
├── controllers/         2 controllers (ai, quota)
├── services/            quota + openai + anthropic + fallback + resume
├── sse/                 events + session-store + stream.handler
├── middleware/          auth + validation + error + rate-limit
├── db/                  redis.ts (DB 2 + AI-specific key builders)
├── utils/               jwt + logger + sentry + errors
└── types/               Zod schemas
```

---

## 🩺 Debugging

**"OPENAI_API_KEY missing but primary provider is OpenAI"**
→ Either set a key or set `AI_PRIMARY_PROVIDER=anthropic`.

**SSE stream cuts off after ~5 minutes**
→ Check your reverse proxy `proxy_read_timeout`. The Node server itself has no timeout (`requestTimeout = 0`).

**"QUOTA_EXCEEDED" when you're sure the tier is premium**
→ Query `GET /quota` to see the tier + reset time. Tier is derived from the JWT role at request time.

---

## 📝 License

Proprietary — All rights reserved.