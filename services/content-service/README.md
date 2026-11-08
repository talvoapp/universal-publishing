# Content Service

Content delivery + entitlement enforcement microservice for
**Universal Publishing Platform**.

Serves articles, books, and chapters from MongoDB, gated by purchase
entitlements checked against PostgreSQL. Free previews are always
available; full reads require a valid purchase or subscription.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Metadata** | Item title, cover, tags, word count |
| **Table of contents** | Chapter list (with free/paid flags) |
| **Previews** | First 15% of content, no purchase required |
| **Full reads** | Gated by EntitlementMiddleware (purchase/subscription/owner/admin) |
| **Cache** | Per-user entitlement cache in Redis (5 min TTL) |

---

## 🏗️ Architecture

```
        ┌──────────────┐
        │ Nginx Gateway│ (Cache-Control: no-store)
        └───────┬──────┘
                │
        ┌───────▼──────────┐
        │ content-service  │
        │ (HTTP + entitlement│
        │  middleware)      │
        └───┬──────┬────┬───┘
            │      │    │
      ┌─────┘      │    └──────┐
      │            │           │
┌─────▼─────┐ ┌────▼─────┐ ┌───▼────┐
│ MongoDB   │ │PostgreSQL│ │ Redis  │
│ (content) │ │(entitle- │ │(cache) │
│ upp_editor│ │  ments)  │ │ DB 4   │
└───────────┘ │marketpl. │ └────────┘
              └──────────┘
```

**Databases:**
- **MongoDB** (`upp_editor`): `drafts` collection (from editor-service)
- **PostgreSQL** (`marketplace_db`): `orders`, `subscriptions`, `items`, `chapters` (from marketplace-service)
- **Redis** (db 4): entitlement cache (`content:ent:{userId}:{itemId}[:{chapterId}]`)

---

## 🔐 Entitlement Model

The **EntitlementMiddleware** is the security boundary. It runs on
every `/read` endpoint and enforces:

| Check | Source |
|---|---|
| **Admin bypass** | JWT role = `admin` |
| **Owner bypass** | `items.author_id` = `user.id` |
| **Purchase** | `orders` where `status = 'succeeded'` and item matches |
| **Subscription** | `subscriptions` where `status = 'active'` |
| **Free chapter** | Chapter index in `items.free_chapters` |

If none match → **403** with:
```json
{
  "type": "https://httpstatuses.io/403",
  "code": "ENTITLEMENT_REQUIRED",
  "detail": "You need to purchase this content to access it",
  "itemId": "...",
  "chapterId": "...",
  "priceCents": 1299,
  "currency": "USD",
  "purchaseUrl": "/market/checkout"
}
```

### Cache strategy

- **Key format**: `content:ent:{userId}:{itemId}[:{chapterId}]`
- **Value**: `"1"` (granted) or `"0"` (denied)
- **TTL**: 5 min (configurable via `ENTITLEMENT_CACHE_TTL`)
- **Invalidation**: `EntitlementService.InvalidateUserCache(userId)` — scan + delete
- **Scoping**: cache is per-user — **never shared** across users

---

## 📡 API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Public (no entitlement check)

| Method | Path | Response |
|---|---|---|
| `GET` | `/content/{itemID}/metadata` | Item title, cover, tags, word count |
| `GET` | `/content/{itemID}/chapters` | Chapter list (index, title, free flag) |
| `GET` | `/content/{itemID}/preview` | First 15% excerpt + purchase URL |
| `GET` | `/content/{itemID}/chapters/{chapterID}/preview` | Chapter excerpt |

### Gated (entitlement required)

| Method | Path | Response |
|---|---|---|
| `GET` | `/content/{itemID}/read` | Full article content |
| `GET` | `/content/{itemID}/chapters/{chapterID}/read` | Full chapter content |

**Gated responses** include headers:
```
Cache-Control: private, no-store, no-cache, must-revalidate
Pragma: no-cache
X-Robots-Tag: noindex, nofollow
```

These ensure the content is **never** cached by CDN or browser.

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/ready` (checks Postgres + Mongo + Redis) |
| `GET` | `/metrics` |

---

## 🔄 Preview Behavior

The `PREVIEW_FRACTION` config (default `0.15`) controls the size of
the free excerpt. The truncation logic:

1. Converts content to `[]rune` (safe for UTF-8 / Arabic / CJK).
2. Takes first `len(runes) * fraction`.
3. Tries to break at a word boundary (within last 20% of cutoff).
4. Appends `…` if truncated.

Example (15% of a 10,000-word book):
- Returns ~1,500 words as an excerpt
- `truncated: true`
- `purchaseUrl: "/market/checkout?item=..."`

---

## 🚀 Running Locally

### Prerequisites

- Go 1.22+
- MongoDB 7 (with `upp_editor` database)
- PostgreSQL 16 (with `marketplace_db`)
- Redis 7 (db 4)

Or Docker Compose:

```bash
docker compose up -d mongodb postgres redis
```

### Setup

```bash
cd services/content-service
cp .env.example .env
go mod tidy
go run ./cmd
```

Listens on `http://localhost:4006`.

---

## 🧪 Testing

```bash
# Unit tests (no external deps — uses build tag `unit`)
go test -tags=unit ./...

# Integration tests (requires Postgres + Mongo + Redis)
export TEST_DATABASE_URL="postgres://upp:upp_dev_password@localhost:5432/marketplace_test?sslmode=disable"
export TEST_MONGO_URL="mongodb://upp:upp_mongo_password@localhost:27017/upp_editor_test?authSource=admin"
export TEST_REDIS_URL="redis://localhost:6379/14"
go test -tags=integration -v ./tests/...

# With race detector
go test -race ./...
```

---

## 📦 Docker

```bash
docker build -t upp/content-service:latest .
docker run --env-file .env.production -p 4006:4006 upp/content-service:latest
```

**Image size**: ~15 MB (static binary on `scratch`).

---

## 📁 Directory Structure

```
cmd/
└── main.go                  Bootstrap (Postgres + Mongo + Redis + server)

internal/
├── config/                  Env loading + validation
├── server/                  HTTP server + router + graceful shutdown
├── middleware/              RequestID, auth, entitlement, error
├── handlers/                HTTP handlers (content, health)
├── services/                Business logic (content, entitlement)
├── models/                  Article, Chapter, Preview structs
├── db/                      Postgres + Mongo + Redis helpers
└── utils/                   Logger + errors
```

---

## 🩺 Debugging

**"ENTITLEMENT_REQUIRED" despite purchasing**
→ Check the cache: `redis-cli -n 4 GET "content:ent:{userId}:{itemId}"`.
If value is `"0"`, the cache is stale. Either:
  - Wait 5 min for TTL expiry
  - Call `EntitlementService.InvalidateUserCache(userId)`

**Preview is empty**
→ Check that `PREVIEW_FRACTION > 0`. Also verify the item's
`content` field in MongoDB isn't empty.

**"Item not found" (404)**
→ Verify the MongoDB document has `status: "published"`. Drafts
are not served by content-service.

**Slow reads**
→ Check the entitlement cache hit rate:
```bash
redis-cli -n 4 DBSIZE
```
If the cache is empty, the DB is being hit on every read. Investigate
Redis connectivity.

**`content` field leaked to CDN**
→ Verify `Cache-Control: private, no-store` header is present on
`/read` responses:
```bash
curl -i http://localhost:4006/api/v1/content/{id}/read -H "Authorization: Bearer ..."
```

---

## 📝 License

Proprietary — All rights reserved.