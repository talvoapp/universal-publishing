# Auth Service

Authentication & authorization microservice for **Universal Publishing Platform**.

Handles user registration, login, JWT issuance/rotation, OAuth (Google/GitHub), password reset, email verification, RBAC, and audit logging.

---

## 🎯 Responsibilities

| Domain | Features |
|---|---|
| **Identity** | Email/password register + login, OAuth sign-up/sign-in, email verification |
| **Sessions** | Access tokens (15 min), refresh tokens (7 days), rotation with reuse detection |
| **Security** | bcrypt hashing, JWT with issuer/audience/type checks, RBAC (reader/author/editor/admin) |
| **Recovery** | Forgot password, reset password, change password (revokes all sessions) |
| **Compliance** | Audit log for every auth event, GDPR/CCPA account deletion (soft + 30-day grace) |
| **Observability** | Structured JSON logs (Pino), Sentry errors, OpenTelemetry traces |

---

## 🏗️ Architecture

```
       ┌────────────────┐
       │  Nginx Gateway │ (rate-limits, routes)
       └────────┬───────┘
                │
       ┌────────▼───────┐
       │  auth-service  │ (this)
       └────────┬───────┘
                │
     ┌──────────┼──────────┐
     │          │          │
┌────▼────┐ ┌───▼───┐ ┌───▼────┐
│Postgres │ │ Redis │ │  SMTP  │
│auth_db  │ │ db:0  │ │Mailhog │
└─────────┘ └───────┘ └────────┘
```

**Databases:**
- **PostgreSQL** (`auth_db`): `users`, `refresh_tokens`, `audit_logs`
- **Redis** (db 0): rate-limit counters, password-reset rate limits, resend-verification rate limits
- **SMTP**: verification & reset emails (Mailhog locally, SES/SendGrid in prod)

---

## 📡 API Reference

Base path: `/api/v1`. All responses are JSON.

### Auth endpoints

| Method | Path | Auth | Body |
|---|---|---|---|
| `POST` | `/auth/register` | — | `{ email, password, displayName }` |
| `POST` | `/auth/login` | — | `{ email, password }` |
| `POST` | `/auth/refresh` | — | `{ refreshToken }` |
| `POST` | `/auth/logout` | — | `{ refreshToken }` |
| `POST` | `/auth/logout-all` | Bearer | — |
| `POST` | `/auth/forgot-password` | — | `{ email }` |
| `POST` | `/auth/reset-password` | — | `{ token, newPassword }` |
| `POST` | `/auth/verify-email` | — | `{ token }` |
| `POST` | `/auth/resend-verification` | Bearer | — |

### User endpoints

| Method | Path | Auth | Body |
|---|---|---|---|
| `GET` | `/users/me` | Bearer | — |
| `PATCH` | `/users/me` | Bearer | `{ displayName?, bio?, avatarUrl?, language? }` |
| `POST` | `/users/me/change-password` | Bearer | `{ currentPassword, newPassword }` |
| `DELETE` | `/users/me` | Bearer | `{ password, confirmPhrase: "DELETE MY ACCOUNT" }` |
| `GET` | `/users/:id` | — | — |

### OAuth endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/oauth/google` | Redirects to Google consent |
| `GET` | `/oauth/google/callback` | Receives code, issues tokens, redirects to frontend |
| `GET` | `/oauth/github` | Redirects to GitHub consent |
| `GET` | `/oauth/github/callback` | Same as Google |

### Health endpoints (bypass auth + rate limit)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness — returns 200 if process is up |
| `GET` | `/ready` | Readiness — returns 200 if Postgres + Redis reachable |

---

## 🔐 Security Model

### Tokens
- **Access token**: HS256 JWT, 15 min, contains `sub`/`email`/`role`/`emailVerified`/`type=access`/`jti`
- **Refresh token**: HS256 JWT, 7 days, **stored SHA-256 hashed**, contains `sub`/`type=refresh`/`familyId`/`jti`
- **Rotation**: every refresh issues a new pair and revokes the old one
- **Reuse detection**: presenting an already-rotated token revokes the **entire family** (theft signal) + audit log

### Password hashing
- bcrypt with **12 rounds** (configurable 10–15, validated at startup)
- Transparent rehash on login if cost has been upgraded (`needsRehash`)

### Rate limits (per IP)

| Endpoint | Window | Max |
|---|---|---|
| `POST /auth/register` | 1 h | 5 |
| `POST /auth/login` | 15 min | 5 failed (success doesn't count) |
| `POST /auth/refresh` | 1 min | 30 |
| `POST /auth/forgot-password` | 1 h | 3 |
| `POST /auth/reset-password` | 1 h | 3 |
| `POST /auth/resend-verification` | 1 h | 3 (per user, Redis) |
| All others | 1 min | 100 (global) |

### RBAC
- Roles are hierarchical: `reader < author < editor < admin`
- `requireRole('admin', 'editor')` — OR semantics
- `requireMinRole('editor')` — hierarchical
- `requireVerifiedEmail` — enforced on publishing routes (used by other services)

---

## 🚀 Running Locally

### Prerequisites
- Node.js 20+, npm 10+
- PostgreSQL 16 (or use Docker — see root README)
- Redis 7
- Mailhog (optional, for email testing)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.example .env
# Edit .env with your DB/Redis URLs

# 3. Run migrations (from repo root)
make migrate

# 4. Start in dev mode (hot reload)
npm run dev
```

The service listens on `http://localhost:4001`.

---

## 🧪 Testing

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# With coverage report (opens HTML in coverage/)
npm run test:ci
```

**Test structure:**
- `tests/setup.ts` — global DB/Redis setup, truncation between tests
- `tests/helpers.ts` — `createTestUser`, `authHeader`, count helpers
- `tests/auth.test.ts` — register/login/refresh/logout/reset/verify flows
- `tests/rbac.test.ts` — role enforcement (reader/author/editor/admin)
- `tests/user.test.ts` — profile CRUD, password change, account deletion
- `tests/validation.test.ts` — Zod schemas edge cases

**Coverage thresholds** (enforced in CI):
- Global: 70% branches, 70% functions, 75% lines, 75% statements
- `auth.service.ts`: 80%+ across the board
- `jwt.util.ts` & `password.util.ts`: 90%+ across the board

---

## 📦 Build & Deploy

### Production build

```bash
npm run build        # compiles src/ → dist/
npm run start        # runs dist/index.js
```

### Docker

```bash
# Production image
docker build -t upp/auth-service:latest .

# Run (requires DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_REFRESH_SECRET)
docker run --env-file .env.production -p 4001:4001 upp/auth-service:latest
```

### Kubernetes

See `infrastructure/kubernetes/auth-deployment.yaml`. The service:
- Listens on port `4001`
- Exposes `/health` (liveness) and `/ready` (readiness)
- Runs as non-root (UID `10001`)
- Uses `tini` as PID 1 for graceful shutdown

---

## 🔧 Environment Variables

Full list in `.env.example`. Critical:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgres://` URL |
| `REDIS_URL` | ✅ | `redis://` URL (db 0) |
| `JWT_SECRET` | ✅ | ≥ 32 chars |
| `JWT_REFRESH_SECRET` | ✅ | ≥ 32 chars, **different** from `JWT_SECRET` |
| `BCRYPT_ROUNDS` | — | default `12`, range 10–15 |
| `GOOGLE_CLIENT_ID/SECRET` | — | leave blank to disable Google OAuth |
| `GITHUB_CLIENT_ID/SECRET` | — | leave blank to disable GitHub OAuth |
| `SMTP_HOST/PORT` | ✅ | Mailhog locally (`mailhog:1025`) |
| `SENTRY_DSN` | — | leave blank to disable error reporting |

**Generate secure secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

---

## 📁 Directory Structure

```
src/
├── app.ts                Express app factory (10 middleware layers)
├── index.ts              Bootstrap + graceful shutdown
├── config.ts             Zod-validated env config
├── routes/
│   ├── index.ts          Route aggregator
│   ├── auth.routes.ts    9 endpoints + per-endpoint limiters
│   ├── user.routes.ts    5 endpoints + requireAuth at router level
│   └── oauth.routes.ts   Google + GitHub flows
├── controllers/
│   ├── auth.controller.ts   Thin HTTP layer
│   └── user.controller.ts
├── services/
│   ├── auth.service.ts      Register/login/refresh/... (business logic)
│   ├── user.service.ts      Profile CRUD, password, deletion
│   ├── oauth.service.ts     Passport strategies
│   └── email.service.ts     Nodemailer + templates
├── middleware/
│   ├── auth.middleware.ts      requireAuth, optionalAuth
│   ├── rbac.middleware.ts      requireRole, requireMinRole, ...
│   ├── validation.middleware.ts validateBody/Query/Params
│   ├── error.middleware.ts     notFoundHandler + errorHandler (RFC 7807)
│   └── rate-limit.middleware.ts 7 limiters (Redis-backed in prod)
├── models/
│   ├── User.model.ts
│   ├── RefreshToken.model.ts
│   └── AuditLog.model.ts
├── db/
│   ├── postgres.ts       Pool + withTransaction + retry
│   └── redis.ts          Singleton + key helper
├── utils/
│   ├── jwt.util.ts
│   ├── password.util.ts
│   ├── logger.ts         Pino with redaction
│   ├── sentry.ts         Optional, no-op if no DSN
│   └── errors.ts         9 error classes
└── types/
    └── index.ts          11 Zod schemas + inferred TS types
```

---

## 🩺 Debugging

### Common issues

**"DATABASE_URL must be a postgres:// URL"**
→ Check `config.ts` validation. Copy from `.env.example` verbatim.

**"Redis client not initialized"**
→ `initRedis()` failed. Check Redis is running: `redis-cli ping` → `PONG`.

**"Test database is missing tables"**
→ Run `make migrate` before `npm test`.

**Tokens rejected on other services**
→ Verify `JWT_SECRET` and `JWT_AUDIENCE` match across services.

### Logs

In development: colored, human-readable (Pino pretty).
In production: single-line JSON, ready for ELK/Datadog.

Filter by component:
```bash
docker logs upp-auth 2>&1 | jq 'select(.component=="auth.service")'
```

---

## 📝 License

Proprietary — All rights reserved.