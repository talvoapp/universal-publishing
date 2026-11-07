# Editor Service

Collaborative smart editor microservice for **Universal Publishing Platform**.

Handles draft lifecycle, version history, tag management, and real-time collaborative editing via WebSocket with patch-based incremental saves.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Draft CRUD** | Create, list (cursor-paginated), get, update metadata, soft-delete |
| **Real-time editing** | WebSocket patches, incremental saves, snapshot every N ops |
| **Version history** | List versions, get specific version (with reconstruction), revert |
| **Presence** | Who is currently editing this draft (Redis-backed) |
| **Tags & Taxonomy** | Add/remove tags, search, static category tree |
| **Publishing** | Validated publish with outbox events to Kafka |

---

## 🏗️ Architecture

```
       ┌─────────────┐
       │ Nginx GW    │
       └──────┬──────┘
              │
    ┌─────────▼──────────┐
    │  editor-service    │
    │  HTTP + WebSocket  │
    └─────────┬──────────┘
              │
      ┌───────┼───────┐
      │       │       │
 ┌────▼───┐ ┌▼────┐ ┌▼─────┐
 │MongoDB │ │Redis│ │Kafka │
 │upp_edit│ │db:1 │ │outbox│
 └────────┘ └─────┘ └──────┘
```

**Storage:**
- **MongoDB** — `drafts` (current state) + `draft_ops` (append-only log)
- **Redis** (db 1) — presence sets, authz cache, Kafka outage buffer
- **Kafka** — outbox events (DraftPublished → feed/marketplace/notifications)

---

## 📡 WebSocket Protocol

**Endpoint:** `wss://<host>/editor/stream?token=<JWT>` (or send token in first frame)

**Client → Server frames:**
```json
{ "type": "auth", "token": "<jwt>" }
{ "type": "subscribe", "draftId": "<uuid>", "sinceVersion": 42 }
{ "type": "patch", "baseVersion": 42, "ops": [...], "clientOpId": "..." }
{ "type": "presence", "cursorPosition": 120 }
{ "type": "ping" }
```

**Server → Client frames:**
```json
{ "type": "auth_ok", "userId": "..." }
{ "type": "subscribed", "draftId": "...", "version": 42, "snapshot": {...} }
{ "type": "ack", "clientOpId": "...", "version": 43, "serverTime": 1700000000000 }
{ "type": "nack", "clientOpId": "...", "reason": "version_mismatch", "serverVersion": 43 }
{ "type": "patch", "baseVersion": 42, "ops": [...], "clientOpId": "...", "userId": "...", "version": 43 }
{ "type": "presence", "users": [{ "userId": "...", "cursorPosition": 120, "lastSeen": "..." }] }
{ "type": "error", "code": "...", "detail": "..." }
{ "type": "pong", "serverTime": 1700000000000 }
```

**Op format (ProseMirror-like):**
- `{ type: 'insert',  pos, text }`
- `{ type: 'delete',  pos, text }`
- `{ type: 'replace', pos, from, to }`
- `{ type: 'attr',    path, value }`

---

## 📡 HTTP API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Drafts

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/editor/drafts` | `{ title?, contentType, language?, metadata? }` | Rate: 20/h |
| `GET` | `/editor/drafts` | — | `?status=&cursor=&limit=` |
| `GET` | `/editor/drafts/:id` | — | |
| `PATCH` | `/editor/drafts/:id` | `{ title?, language?, metadata? }` | `If-Match` for optimistic |
| `DELETE` | `/editor/drafts/:id` | — | Soft delete |
| `POST` | `/editor/drafts/:id/publish` | — | Requires ≥100 words + verified email. Rate: 10/h |
| `POST` | `/editor/drafts/:id/snapshot` | — | Force snapshot |
| `POST` | `/editor/drafts/:id/tags` | `{ tags: string[] }` | Max 20 total |
| `DELETE` | `/editor/drafts/:id/tags/:tag` | — | |

### Versions

| Method | Path | Notes |
|---|---|---|
| `GET` | `/versions/drafts/:id` | `?cursor=&limit=` |
| `GET` | `/versions/drafts/:id/:version` | Reconstructs content from ops |
| `POST` | `/versions/drafts/:id/revert` | `{ to_version }` — append-only |

### Taxonomy (public)

| Method | Path | Cache |
|---|---|---|
| `GET` | `/taxonomy/categories` | 1 h |
| `GET` | `/taxonomy/tags?q=` | 5 m |

### Health

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Readiness (Mongo + Redis) |

---

## 🔐 Security Model

### WebSocket
- JWT verified **on the `auth` frame** (not during upgrade)
- Max **10 connections per user** (oldest closed on overflow)
- **60 msg/sec** per connection (token bucket)
- **512 KB** max payload (enforced by `ws`)
- Binary frames rejected
- Ping every 30s; terminate if no pong for 10s
- **Draft content NEVER logged** (`content`, `ops`, `patch` in Pino redaction)

### HTTP
- Rate limits: draft-create 20/h, publish 10/h, revert 10/h
- Body limit 100 KB (content goes through WebSocket, not HTTP)
- Ownership check via `assertOwnerOrAdmin`

### Data integrity
- **Append-only op log** — `draft_ops` can never be updated (`pre('save')` guard)
- **Optimistic concurrency** — `version` checked in update query
- **Atomic patch persist** — Mongo transaction: insert op + update draft
- **Reuse-safe revert** — creates new op, doesn't modify history

---

## 🚀 Running Locally

```bash
# Install
npm install

# Env
cp .env.example .env
# Edit URLs

# Start dev (hot reload)
npm run dev
```

Listens on `http://localhost:4002` (HTTP + WebSocket).

---

## 🧪 Testing

```bash
npm test          # once, with coverage
npm run test:ci   # CI mode
```

---

## 📦 Docker

```bash
docker build -t upp/editor-service:latest .
docker run --env-file .env.production -p 4002:4002 upp/editor-service:latest
```

`Dockerfile` uses:
- Multi-stage build (deps → builder → runtime)
- Non-root (UID 10001)
- `tini` as PID 1 (SIGTERM forwarding → clean WebSocket close frames)
- HTTP health check on `/health`

---

## 📁 Directory Structure

```
src/
├── index.ts              Bootstrap (HTTP + WS + graceful shutdown)
├── app.ts                Express factory (HTTP only)
├── config.ts             Zod-validated config (45 vars)
├── routes/               3 feature routers
├── controllers/          3 controllers (thin)
├── services/             3 services (business logic)
├── middleware/           auth + validation + error + rate-limit
├── models/               Draft + DraftOp (Mongoose)
├── db/                   mongo.ts + redis.ts
├── websocket/            handler + session + patch-handler + presence
├── outbox/               Kafka publisher (buffered fallback)
├── utils/                jwt + logger + sentry + errors
└── types/                Zod schemas
```

---

## 📝 License

Proprietary — All rights reserved.