# Feed Service

Real-time social feed microservice for **Universal Publishing Platform**.

Serves personalized feeds with **hybrid fan-out** (push for normal users, pull for celebrities), backed by Redis Sorted Sets for O(log N) reads and cursor-based pagination.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Personal feed** | Merged timeline from followed authors (push + pull) |
| **Author posts** | All posts by a specific author |
| **Follow graph** | Follow/unfollow + listings |
| **Event-driven updates** | Consume `DraftPublished` from Kafka |
| **Hybrid fan-out** | Automatic push/pull based on follower count |

---

## 🏗️ Architecture

```
       ┌──────────────┐
       │ Nginx Gateway│
       └───────┬──────┘
               │
       ┌───────▼──────────┐         ┌────────────────┐
       │  feed-service    │◀────────│  Kafka         │
       │                  │         │  DraftPublished│
       │  HTTP + Consumer │         └────────────────┘
       └───┬──────────┬───┘
           │          │
      ┌────▼────┐ ┌───▼────┐
      │Postgres │ │ Redis  │
      │feed_db  │ │ DB 5   │
      └─────────┘ └────────┘
```

**Databases:**
- **PostgreSQL** (`feed_db`): `follows`, `users_follow_counts`, `posts_metadata`
- **Redis** (db 5): user timelines, author posts indexes, celebrity followees cache
- **Kafka**: consumes `DraftPublished` events

---

## 🎯 Hybrid Fan-Out — The Core Algorithm

The **celebrity problem**: a user with 10M followers would require 10M timeline writes on every post.

### Solution: Hybrid fan-out

| Author Category | Followers | Strategy | On Publish | On Read |
|---|---|---|---|---|
| **Normal** | ≤ `CELEBRITY_THRESHOLD` (1000) | **PUSH** | Fan out to all followers (Redis ZADD) | Fetch from own timeline |
| **Celebrity** | > `CELEBRITY_THRESHOLD` | **PULL** | Write only to author's own index | Fetch from each celebrity author at read time |

### Read Path (Merged)

```
Reader's feed =
   (a) Pre-computed timeline (ZSet, from normal authors)
 + (b) Recent posts from celebrities they follow (fetched at read)
 + (c) Author's own posts (always included)
        │
        ▼
   Merge (dedupe by postID, sort by score DESC)
        │
        ▼
   Cursor-paginated page
```

### Write Path (on DraftPublished)

```
Kafka DraftPublished
        │
        ▼
Fetch author's follower_count
        │
        ▼
        ┌─────────────────┐
        │ isCelebrity?    │
        └────────┬────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
      PUSH              PULL
        │                 │
  ZADD to every       ZADD to
  follower timeline   author index only
        │                 │
        └────────┬────────┘
                 ▼
    Always ZADD to author's own timeline
    + author's own index
```

---

## 📡 API Reference

Base path: `/api/v1`. All endpoints require `Authorization: Bearer <JWT>`.

### Feed reads

| Method | Path | Notes |
|---|---|---|
| `GET` | `/feed?limit=20&cursor=...` | Current user's feed (merged) |
| `GET` | `/feed/user/{userID}` | Another user's feed (public view) |
| `GET` | `/feed/author/{authorID}` | All posts by a specific author |

### Follow operations

| Method | Path | Notes |
|---|---|---|
| `POST` | `/follow/{userID}` | Follow (idempotent) |
| `DELETE` | `/follow/{userID}` | Unfollow (idempotent) |
| `GET` | `/follow/followers` | My followers |
| `GET` | `/follow/following` | Who I follow |

### Health

| Method | Path |
|---|---|
| `GET` | `/health` |
| `GET` | `/ready` (checks Postgres + Redis) |
| `GET` | `/metrics` |

---

## 📄 Response format

### Feed page

```json
{
  "posts": [
    {
      "id": "post-uuid",
      "authorId": "author-uuid",
      "title": "My Post",
      "excerpt": "First 280 chars…",
      "contentType": "article",
      "wordCount": 1500,
      "tags": ["tech", "ai"],
      "publishedAt": "2025-01-15T10:30:00Z"
    }
  ],
  "nextCursor": "MTcwMDAwMDAwMF9hYmMxMjM",
  "hasMore": true
}
```

**Cursor format**: `base64("{unix_score}_{postID}")` — opaque to clients.

**Pagination**:
- First page: omit `cursor`
- Next page: pass `cursor` from previous response
- `hasMore: false` indicates end of feed

---

## 🔐 Security Model

### Auth
- JWT verified via HS256 with `issuer` + `audience` + `type=access`
- Every endpoint requires authentication

### Rate limits (via Nginx)
- Global: 120 req/min per IP
- Per-user (v2): to be added

### Counter integrity
- `users_follow_counts` updated inside `WithTx` (atomic)
- `GREATEST(0, count - 1)` prevents negatives
- `CHECK (follower_id <> followee_id)` in `follows` — no self-follow

### Cache invalidation
- Timeline entries are immutable (added once, trimmed by `ZRemRangeByRank`)
- Followees cache: 5 min TTL (auto-refresh)

---

## 🚀 Running Locally

### Prerequisites

- Go 1.22+
- PostgreSQL 16 (with `feed_db`)
- Redis 7 (db 5)
- Kafka 3+

Or Docker Compose:

```bash
docker compose up -d postgres redis kafka
```

### Setup

```bash
cd services/feed-service
cp .env.example .env
make migrate
make dev
```

Listens on `http://localhost:4007`.

---

## 🧪 Testing

```bash
# Unit tests (pure functions — merge, cursor)
go test ./internal/feed/...

# Integration tests (requires Postgres + Redis)
export TEST_DATABASE_URL="postgres://upp:upp_dev_password@localhost:5432/feed_test?sslmode=disable"
export TEST_REDIS_URL="redis://localhost:6379/15"
go test -tags=integration -v ./tests/...

# With race detector
go test -race ./...
```

---

## 📦 Docker

```bash
docker build -t upp/feed-service:latest .
docker run --env-file .env.production -p 4007:4007 upp/feed-service:latest
```

**Image size**: ~15 MB (static binary on `scratch`).

---

## 📁 Directory Structure

```
cmd/
└── main.go                  Bootstrap (Postgres + Redis + Kafka + server)

internal/
├── config/                  Env loading + validation
├── server/                  HTTP server + router + graceful shutdown
├── middleware/              RequestID, auth, error
├── handlers/                HTTP handlers (feed, follow, health)
├── feed/                    Hybrid feed engine
│   ├── hybrid.go            Top-level read orchestrator
│   ├── pull.go              Celebrity posts fetch
│   ├── merge.go             Merge + sort + dedupe
│   └── keys.go              Cursor encoding
├── consumer/                Kafka consumer (DraftPublished → fan-out)
├── models/                  Post, FeedPage, Follow
├── db/                      Postgres + Redis helpers + migrations
└── utils/                   Logger + errors
```

---

## 🩺 Debugging

### Feed is empty
1. Check if user follows anyone: `GET /follow/following`
2. Check if followees have published: check Kafka → consumer logs
3. Check Redis timeline: `redis-cli -n 5 ZCARD feed:timeline:{userId}`

### Celebrity posts not appearing
- Check if author is a celebrity: `SELECT follower_count FROM users_follow_counts WHERE user_id = ?`
- Verify `feed:author:{authorId}` exists in Redis
- Check `CELEBRITY_THRESHOLD` config

### Follow counter drift
```sql
-- Verify counter matches actual follows
SELECT c.user_id, c.follower_count, COUNT(f.follower_id) AS actual
FROM users_follow_counts c
LEFT JOIN follows f ON f.followee_id = c.user_id AND f.status = 'active'
GROUP BY c.user_id, c.follower_count
HAVING c.follower_count != COUNT(f.follower_id);
```

If drift detected, recount:
```sql
UPDATE users_follow_counts c SET follower_count = (
  SELECT COUNT(*) FROM follows WHERE followee_id = c.user_id AND status = 'active'
);
```

### Kafka consumer stuck
- Check consumer group lag: `kafka-consumer-groups --describe --group feed-service`
- Check `consumer_starting` log — if missing, Kafka connection failed
- Verify offset commit: look for `commit_failed` logs

### High latency on feed reads
- Check number of celebrities followed: `SELECT COUNT(*) FROM follows f JOIN users_follow_counts c ON c.user_id = f.followee_id WHERE f.follower_id = ? AND c.follower_count > 1000`
- If > 100, consider capping `PerCelebrityLimit` or moving to background pre-compute

---

## 🎯 Known Limitations (v1)

1. **`DraftDeleted`** events are not processed. A deleted post remains in timelines until TTL or manual cleanup. v2 will add `ZREM` handling.
2. **`posts_metadata`** table may not be populated (v2 fills from consumer). Feed falls back to minimal Post objects (ID + score only).
3. **Celebrity limit** per read = 5 posts. If user follows many celebrities, some posts are missed on the first page.
4. **No fan-out batching** — a single `DraftPublished` event triggers one `SELECT` + one pipeline. For authors near the threshold (1000 followers), this is one 1000-iteration loop.

---

## 📝 License

Proprietary — All rights reserved.