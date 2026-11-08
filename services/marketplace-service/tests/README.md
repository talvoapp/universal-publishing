# Marketplace Service — Integration Tests

This directory contains **integration tests** for the marketplace service.
They differ from unit tests (in `internal/*/..._test.go`) by requiring real
external services: **PostgreSQL** and **Redis**.

They are gated behind the `integration` build tag, so `go test ./...` in
CI or locally will skip them by default.

---

## 📋 Table of Contents

- [Difference from Unit Tests](#difference-from-unit-tests)
- [Prerequisites](#prerequisites)
- [Running Locally](#running-locally)
- [Running in CI](#running-in-ci)
- [Stripe Mocking](#stripe-mocking)
- [Test Isolation](#test-isolation)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)

---

## Difference from Unit Tests

| Aspect | Unit tests (`internal/*/..._test.go`) | Integration tests (`tests/*_test.go`) |
|---|---|---|
| **Location** | Next to the code (idiomatic Go) | Dedicated `tests/` directory |
| **Build tag** | None | `//go:build integration` |
| **Runs by default** | ✅ Yes (`go test ./...`) | ❌ No (requires `-tags=integration`) |
| **External deps** | None (mocks/stubs) | PostgreSQL + Redis |
| **Speed** | < 1s | 5-30s |
| **Purpose** | Pure logic (validators, utils, models) | Full HTTP flow + real SQL |
| **CI job** | Always | Dedicated job with services |

**Why both?**

- **Unit tests** catch logic bugs fast, run on every PR, and are the
  first line of defense.
- **Integration tests** catch SQL mistakes, transaction bugs, and
  middleware ordering issues — things unit tests with mocks cannot
  detect.

---

## Prerequisites

### 1. Running services

```bash
# From the repository root
cd ../../..
docker compose up -d postgres redis
```

### 2. Test environment variables

```bash
export TEST_DATABASE_URL="postgres://upp:upp_dev_password@localhost:5432/marketplace_test?sslmode=disable"
export TEST_REDIS_URL="redis://localhost:6379/13"
```

> **Note**: Redis uses **DB 13** for tests (not 3 which the marketplace
> service uses). This ensures integration tests never flush production
> idempotency keys or rate limits.

### 3. Test database creation (one-time)

```bash
# Create marketplace_test if it doesn't exist
psql "postgres://upp:upp_dev_password@localhost:5432/postgres" \
  -c "CREATE DATABASE marketplace_test"
```

### 4. Migrations

```bash
# Apply all migrations to the test DB
for f in internal/db/migrations/*.sql; do
  echo "→ $f"
  psql "$TEST_DATABASE_URL" -f "$f"
done
```

Or use the Makefile target:

```bash
make migrate-test
```

*(If not present, add to `Makefile`:)*

```makefile
migrate-test: ## Run migrations against the test DB
	@for f in internal/db/migrations/*.sql; do \
		psql "$$TEST_DATABASE_URL" -f "$$f"; \
	done
```

---

## Running Locally

### All integration tests

```bash
cd services/marketplace-service
go test -tags=integration -v ./tests/...
```

Expected output:

```
=== RUN   TestCatalog_ListPublishedItems
--- PASS: TestCatalog_ListPublishedItems (0.12s)
=== RUN   TestCatalog_ListWithLimit
--- PASS: TestCatalog_ListWithLimit (0.09s)
=== RUN   TestCheckout_RequiresAuth
--- PASS: TestCheckout_RequiresAuth (0.01s)
...
PASS
ok      github.com/universal-publishing-platform/marketplace-service/tests    2.834s
```

### Single test

```bash
go test -tags=integration -v ./tests/ -run TestCheckout_RequiresAuth
```

### With coverage

```bash
go test -tags=integration -cover -coverprofile=coverage-integration.out ./tests/...
go tool cover -html=coverage-integration.out -o coverage-integration.html
```

### With race detector (recommended)

```bash
go test -tags=integration -race -v ./tests/...
```

The race detector will catch concurrency bugs in the outbox relay, rate
limiter, and idempotency middleware.

### Verbose per-step output

```bash
go test -tags=integration -v -count=1 ./tests/...
```

`-count=1` disables the test cache — useful when you've modified
migrations but not the test code.

---

## Running in CI

### GitHub Actions example

```yaml
name: marketplace-integration

on: [push, pull_request]

jobs:
  integration:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: upp
          POSTGRES_PASSWORD: upp_dev_password
          POSTGRES_DB: marketplace_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U upp"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7.2-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - name: Apply migrations
        working-directory: services/marketplace-service
        run: |
          for f in internal/db/migrations/*.sql; do
            PGPASSWORD=upp_dev_password psql \
              -h localhost -U upp -d marketplace_test -f "$f"
          done

      - name: Run integration tests
        working-directory: services/marketplace-service
        env:
          TEST_DATABASE_URL: postgres://upp:upp_dev_password@localhost:5432/marketplace_test?sslmode=disable
          TEST_REDIS_URL: redis://localhost:6379/13
          STRIPE_SECRET_KEY: sk_test_fake_for_ci
          STRIPE_WEBHOOK_SECRET: whsec_test_fake_for_ci
        run: |
          go test -tags=integration -race -cover ./tests/...

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: marketplace-integration-coverage
          path: services/marketplace-service/coverage-integration.out
```

---

## Stripe Mocking

Integration tests **never** call the real Stripe API. Two approaches are
used:

### Approach 1: Stub transport (used in `checkout_test.go`)

We replace `stripe-go`'s HTTP backend with an in-memory stub that
returns canned responses. This is fast and requires no external
process.

**Pros**: zero setup, runs anywhere.
**Cons**: doesn't catch mismatches between our code and Stripe's real API shape.

### Approach 2: `stripe-mock` (recommended for CI)

[`stripe-mock`](https://github.com/stripe/stripe-mock) is Stripe's
official mock server. It:
- Mirrors Stripe's real API schema
- Rejects malformed requests
- Requires no API key

```bash
# Install (one-time)
go install github.com/stripe/stripe-mock@latest

# Run in background
stripe-mock -http-port 12111 &

# Point stripe-go at it
export STRIPE_API_BASE=http://localhost:12111
```

Then `stripe-go` uses the mock transparently for all calls.

**Recommendation**: use `stripe-mock` in CI for the checkout tests, and
keep the stub transport for fast local iteration.

---

## Test Isolation

Every test calls `env.Truncate(t)` at the start, which ensures:

### 1. PostgreSQL truncation

```sql
TRUNCATE TABLE
    outbox,
    subscriptions,
    orders,
    chapters,
    items
RESTART IDENTITY CASCADE
```

Order matters (children before parents due to FK constraints):
- `outbox` references `orders` (logically — no FK, but cleanup first)
- `orders` references `items`, `chapters`
- `chapters` references `items`
- `items` is the root

`RESTART IDENTITY` resets sequences so UUIDs are the only source of
identity — deterministic tests.

### 2. Redis flush (namespaced)

```go
keys, _ := env.Redis.Keys(ctx, "market:*").Result()
if len(keys) > 0 {
    env.Redis.Del(ctx, keys...)
}
```

Only keys with the `market:` prefix are deleted. This guarantees:
- Dev environment's `auth:*`, `editor:*`, etc. keys are untouched
- Test isolation is per-service, not global

### 3. No `t.Parallel()`

All integration tests run sequentially. They mutate shared DB state,
so parallelism would cause flaky failures. If you need parallel tests,
give each one its own database schema or Redis prefix.

### 4. Fresh IDs per test

Every test calls `uuid.NewString()` for buyer/author/item IDs. This
prevents collisions even if truncation fails.

---

## File Structure

```
tests/
├── README.md              # This file
├── setup_test.go          # TestEnv, NewTestEnv, Truncate, seed helpers
├── chi_helper_test.go     # chi route context helper
├── catalog_test.go        # 6 tests: list/get/chapters
├── checkout_test.go       # 7 tests: initiate/confirm + Stripe stubs
└── webhook_test.go        # 3 tests: signature verification + dedup
```

### Total: **16 integration tests**

| File | Tests | What it verifies |
|---|---|---|
| `catalog_test.go` | 6 | Listing published items, pagination, chapters |
| `checkout_test.go` | 7 | Initiation, validation, confirmation, auth |
| `webhook_test.go` | 3 | Signature verification, body size limits |

Combined with the 19 unit tests (in `internal/*/..._test.go`), the
marketplace service has **35 tests** covering:
- ✅ HTTP handlers (validation, auth, error responses)
- ✅ SQL queries (real DB)
- ✅ Stripe integration (mocked)
- ✅ Webhook signature verification
- ✅ Outbox event emission
- ✅ Idempotency semantics
- ✅ Rate limiting

---

## Troubleshooting

### `TEST_DATABASE_URL is required for integration tests`

**Cause**: env var not set.
**Fix**:

```bash
export TEST_DATABASE_URL="postgres://upp:upp_dev_password@localhost:5432/marketplace_test?sslmode=disable"
```

### `psql: error: connection to server ... failed`

**Cause**: Postgres not running.
**Fix**:

```bash
docker compose up -d postgres
docker compose ps postgres   # verify it's healthy
```

### `relation "items" does not exist`

**Cause**: migrations not applied.
**Fix**:

```bash
for f in internal/db/migrations/*.sql; do
  psql "$TEST_DATABASE_URL" -f "$f"
done
```

### `dial tcp [::1]:6379: connect: connection refused`

**Cause**: Redis not running.
**Fix**:

```bash
docker compose up -d redis
redis-cli -n 13 ping   # should return PONG
```

### `stripe-go` panics with `stripe: API key not set`

**Cause**: `STRIPE_SECRET_KEY` not set in test environment.
**Fix**:

```bash
export STRIPE_SECRET_KEY="sk_test_fake"
```

(Any string starting with `sk_test_` works — the stub transport
ignores it.)

### Tests pass locally, fail in CI

**Cause**: environmental drift (different Postgres version, Redis
config, etc.).
**Fix**: pin image versions in CI (`postgres:16-alpine`,
`redis:7.2-alpine`) to match local Docker Compose.

### Flaky test at `TestCheckout_ConfirmNonExistentOrder`

**Cause**: race condition with chi route context (if URL params not set).
**Fix**: ensure `withChiParam` is called BEFORE serving the request. See
`chi_helper_test.go`.

### Slow tests (>30s)

**Cause**: DB queries are missing indexes, or truncation is slow on
large datasets.
**Fix**:

```bash
# Check for missing indexes
EXPLAIN ANALYZE SELECT ... FROM items WHERE is_published = TRUE;
```

All migrations include the required indexes. If you added columns to
`items` or `orders`, add corresponding indexes.

---

## Adding New Tests

When adding a new integration test:

1. **Use `NewTestEnv(t)`** for DB/Redis access
2. **Call `env.Truncate(t)`** first
3. **Use seed helpers** (`SeedItem`, `SeedChapter`, `SeedOrder`)
4. **Use `withUser`** to inject authenticated context
5. **Use `withChiParam`** for URL params
6. **Add `//go:build integration`** at the top

Example skeleton:

```go
//go:build integration

package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestMyFeature_DoesSomething(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	// Seed data
	itemID := env.SeedItem(t, uuid.NewString(), uuid.NewString(), 1299)

	// Build request
	req := httptest.NewRequest(http.MethodGet, "/api/v1/market/items/"+itemID, nil)
	req = withUser(req, uuid.NewString())
	w := httptest.NewRecorder()

	// Invoke handler
	myHandler.Get(w, req)

	// Assert
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["id"] != itemID {
		t.Errorf("wrong id")
	}
}
```

---

## Further Reading

- **Unit tests**: `internal/*/..._test.go` (no build tag)
- **Outbox relay tests**: `internal/outbox/relay_test.go`
- **Marketplace README**: `../README.md`
- **Platform architecture**: `../../../docs/architecture/`

---

**Last updated**: 2025 — maintained by the platform team.