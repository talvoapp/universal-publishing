# Universal Publishing Platform

> A high-performance, decoupled microservices platform for writing, publishing, and monetizing digital content — articles, books, news, and more.

[![CI](https://github.com/your-org/universal-publishing-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/universal-publishing-platform/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Go](https://img.shields.io/badge/go-%3E%3D1.22-blue.svg)](https://go.dev/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.11-yellow.svg)](https://www.python.org/)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Local Endpoints](#local-endpoints)
- [Common Make Targets](#common-make-targets)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style & Conventions](#code-style--conventions)
- [Environment Configuration](#environment-configuration)
- [Security](#security)
- [Performance](#performance)
- [Contributing](#contributing)
- [Branching & Commit Guidelines](#branching--commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)
- [License](#license)

---

## Overview

The **Universal Publishing Platform** is a full-stack, cloud-native system that lets authors write, format, publish, and sell their work across formats (articles, ebooks, news posts, subscriptions). It is designed around four core modules:

| Module | Description |
|---|---|
| **Smart Editor** | Real-time collaborative rich-text editor with AI assistance (grammar, rephrasing, summarization). |
| **Formatting Engine** | Converts drafts into `PDF`, `EPUB`, `MOBI`, and `DOCX` via headless rendering workers. |
| **Marketplace & Monetization** | Pay-per-book, pay-per-chapter, and subscription billing via Stripe + Stripe Connect + Stripe Tax. |
| **Social Feed** | Hybrid fan-out feed (push for regular users, pull for high-follower accounts) powered by Redis Sorted Sets. |

The system follows a **decoupled microservices architecture** deployed on auto-scaling cloud infrastructure (AWS or GCP), fronted by **Cloudflare CDN + WAF** and an **API Gateway**.

---

## Architecture

```
                      [ User Devices: Web & Mobile App ]
                                      │
                                      ▼
                       [ Cloudflare CDN & WAF / API Gateway ]
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           ▼                          ▼                          ▼
   [ Authentication ]         [ Smart Editor ]         [ Marketplace Engine ]
   Node.js / Express          Next.js Serverless       Go / FastAPI
   JWT, OAuth 2.0             Operational Transforms   Microtransactions
           │                          │                          │
           └──────────────────────────┼──────────────────────────┘
                                      ▼
                        [ Distributed Databases & Caching ]
                       • PostgreSQL (ACID - Transactions)
                       • MongoDB (Document Store - Articles/Books)
                       • Redis (In-Memory Cache - Newsfeed & Sessions)
```

For architectural deep-dives, see [`docs/architecture/`](docs/architecture/).

---

## Technology Stack

### Frontend
- **React 18 + Vite + TypeScript** — authenticated dashboard (`frontend/web-dashboard/`)
- **Next.js 14 (App Router)** — SEO-optimized public site (`frontend/public-site/`)
- **React Native (Expo)** — cross-platform mobile app (`frontend/mobile/`)

### Backend
- **Node.js 20 + TypeScript** — Auth, Editor (WebSocket), AI (SSE), Notifications
- **Go 1.22** — Marketplace, Wallet (double-entry ledger), Content (entitlement gate), Feed (hybrid fan-out)
- **Python 3.11** — Formatting workers (Pandoc, WeasyPrint, Puppeteer)

### Data Stores
- **PostgreSQL 16** — transactional data (users, orders, wallets, entitlements)
- **MongoDB 7** — document store (drafts, articles, books, chapters)
- **Redis 7** — sessions, cache, quotas, feeds, entitlement cache

### Messaging & Storage
- **Apache Kafka** — transactional outbox event streaming
- **RabbitMQ** — background rendering job queue
- **AWS S3 / MinIO** — asset storage (covers, PDFs, EPUBs)
- **Cloudflare CDN** — global asset delivery

### Payments
- **Stripe** — payments, subscriptions, tax calculation, Connect payouts

### Observability
- **OpenTelemetry** — distributed tracing
- **Prometheus + Grafana** — metrics & dashboards
- **Jaeger** — trace visualization
- **ELK / Loki** — centralized logging

---

## Repository Layout

```
universal-publishing-platform/
├── infrastructure/         # Nginx, Terraform, Kubernetes, monitoring
├── services/               # 9 backend microservices
│   ├── auth-service/       # Node.js  — JWT, OAuth, RBAC
│   ├── editor-service/     # Node.js  — WebSocket editor, drafts
│   ├── ai-service/         # Node.js  — SSE AI assistant, quotas
│   ├── formatting-service/ # Python   — PDF/EPUB/MOBI/DOCX workers
│   ├── marketplace-service/# Go       — Stripe checkout, catalog
│   ├── wallet-service/     # Go       — double-entry ledger, payouts
│   ├── content-service/    # Go       — entitlement-gated content
│   ├── feed-service/       # Go       — hybrid fan-out feed
│   └── notification-service/ # Node.js — email, push, in-app
├── frontend/
│   ├── web-dashboard/      # React + Vite
│   ├── public-site/        # Next.js (SEO)
│   └── mobile/             # React Native
├── packages/
│   ├── shared-types/       # TypeScript types shared across services
│   ├── event-schemas/      # Outbox event schemas (shared contract)
│   └── ui-components/      # Design system
├── database/
│   ├── postgres/migrations/# SQL migrations
│   ├── mongodb/schemas/    # JSON Schema validators
│   └── redis/              # Key naming conventions
├── docs/                   # Architecture, OpenAPI, runbooks, legal
├── scripts/                # Setup, migrations, backups, deploy
├── tests/                  # E2E (Playwright) and load (k6)
├── .github/workflows/      # CI/CD pipelines
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| **Docker** | 24+ | Local containerized stack |
| **Docker Compose** | v2 | Multi-service orchestration |
| **Node.js** | 20 LTS | Local development without Docker |
| **Go** | 1.22+ | Local Go development |
| **Python** | 3.11+ | Local Python development |
| **Make** | any | Build/run shortcuts |
| **Git** | 2.40+ | Version control |

> **Windows users:** Use **Docker Desktop** with WSL 2 backend, or PowerShell. `chmod`/`bash` are not available in native PowerShell. Use `docker compose` directly if `make` is not installed.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/universal-publishing-platform.git
cd universal-publishing-platform

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in required secrets (Stripe, OpenAI, etc.)

# 3. Build and start all services
make up

# 4. Run database migrations
make migrate

# 5. Seed demo data (optional)
make seed

# 6. Verify health
curl http://localhost:8080/health
```

The stack is ready when `curl http://localhost:8080/health` returns `{"status":"ok"}`.

---

## Local Endpoints

| Service | URL | Notes |
|---|---|---|
| **API Gateway** | http://localhost:8080 | Single entry point for all services |
| **Web Dashboard** | http://localhost:3000 | Author/editor UI |
| **Public Site** | http://localhost:3001 | Reader-facing site |
| **Grafana** | http://localhost:3030 | `admin` / `admin` |
| **Jaeger UI** | http://localhost:16686 | Distributed traces |
| **Prometheus** | http://localhost:9090 | Metrics |
| **RabbitMQ Management** | http://localhost:15672 | `upp` / `upp_rabbit_password` |
| **MinIO Console** | http://localhost:9001 | `upp_minio` / `upp_minio_password` |
| **MailHog (email)** | http://localhost:8025 | Captures outbound email in dev |

---

## Common Make Targets

| Command | Description |
|---|---|
| `make up` | Build & start all services |
| `make up-core` | Start databases & brokers only |
| `make down` | Stop services |
| `make down-v` | Stop services & delete volumes (⚠️ destroys data) |
| `make ps` | Show service status |
| `make logs` | Tail all logs |
| `make migrate` | Apply PostgreSQL migrations |
| `make seed` | Insert demo data |
| `make test` | Run all unit tests |
| `make lint` | Run linters across services |
| `make build` | Build all Docker images |
| `make clean` | Remove all containers and volumes |
| `make reset` | Full reset: clean + up + migrate + seed |

Run `make help` for the full list.

---

## Development Workflow

### Without Docker (native)
Each service can be run independently:

```bash
# Node.js services
cd services/auth-service
npm install
npm run dev

# Go services
cd services/marketplace-service
go mod download
go run ./cmd/main.go

# Python services
cd services/formatting-service
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m app.main
```

### With Docker (recommended)
Docker Compose handles networking, environment variables, and dependencies automatically. Changes to source code are hot-reloaded in `Dockerfile.dev` variants.

---

## Testing

| Layer | Tool | Command |
|---|---|---|
| Unit (Node) | Jest | `npm test` in each service |
| Unit (Go) | `go test` | `go test ./...` in each service |
| Unit (Python) | pytest | `pytest` in `services/formatting-service` |
| E2E | Playwright | `cd tests/e2e && npm test` |
| Load | k6 | `k6 run tests/load/k6-auth.js` |

CI runs all unit tests, linters, and a smoke E2E suite on every PR.

---

## Code Style & Conventions

- **TypeScript / JavaScript:** ESLint + Prettier (`npm run lint`, `npm run format`)
- **Go:** `gofmt`, `go vet`, `staticcheck`
- **Python:** Ruff + Black
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- **Branches:** `feature/<short-desc>`, `fix/<short-desc>`, `chore/<short-desc>`
- **API changes:** Must update the corresponding `docs/openapi/*.yaml`
- **Database changes:** Must add a numbered migration under `database/postgres/migrations/`

---

## Environment Configuration

All environment variables are documented in [`.env.example`](./.env.example). Key groups:

- **Database URLs** — PostgreSQL, MongoDB, Redis (one DB per concern)
- **Auth** — JWT secrets, OAuth client IDs
- **Payments** — Stripe keys, webhook secret, platform fee
- **AI Providers** — OpenAI, Anthropic, per-tier quotas
- **Storage** — S3/MinIO credentials and bucket
- **Observability** — OTLP endpoint, sampling rate
- **Feature Flags** — Toggle AI, pay-per-chapter, subscriptions, hybrid feed, DMCA workflow

> ⚠️ **Never commit `.env`.** Only `.env.example` belongs in the repository.

---

## Security

- **Authentication:** JWT (15-minute access tokens) + refresh tokens (7 days)
- **Authorization:** RBAC with four roles — `Reader`, `Author`, `Editor/Journalist`, `Admin`
- **Content protection:** Server-side entitlement middleware on every gated request; `Cache-Control: private, no-store` on `/api/v1/content/*`
- **Payments:** Stripe webhook signature verification; idempotency keys on all mutating money endpoints
- **Rate limiting:** Per-endpoint Redis token buckets (auth, AI, checkout, general)
- **Secrets:** Managed via environment variables; production uses AWS Secrets Manager
- **Network:** Cloudflare WAF in production; strict CORS/CSP in all environments

Report security issues to **security@upp.local** — do not open public issues.

---

## Performance

- **Feeds:** Redis Sorted Sets for O(log n) reads; hybrid push/pull for celebrity accounts
- **Editor:** Debounced WebSocket persistence (300–500 ms); incremental patches (append-only `draft_ops` collection)
- **Assets:** Cloudflare CDN + automatic responsive image resizing
- **AI:** SSE streaming to prevent HTTP timeouts; per-user token quotas
- **Database:** B-tree indexes on `user_id`, `slug`, `status`, `published_at`; partial indexes for hot queries

---

## Contributing

We welcome contributions from the team and approved external collaborators.

1. **Read the architecture docs** under [`docs/architecture/`](docs/architecture/) before writing code.
2. **Find or open an issue** describing what you plan to work on.
3. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
4. **Write code + tests.** Any new endpoint must have:
   - Handler / controller code
   - Unit test(s)
   - OpenAPI update under `docs/openapi/`
   - Migration if the DB schema changed
5. **Run the full check locally:**
   ```bash
   make lint
   make test
   ```
6. **Commit using Conventional Commits.** Example:
   ```
   feat(marketplace): add pay-per-chapter checkout flow
   ```
7. **Push and open a Pull Request.**

---

## Branching & Commit Guidelines

### Branch naming
| Prefix | Use |
|---|---|
| `feature/<name>` | New feature |
| `fix/<name>` | Bug fix |
| `chore/<name>` | Maintenance, deps, config |
| `docs/<name>` | Documentation only |
| `refactor/<name>` | Code restructuring, no behavior change |
| `hotfix/<name>` | Urgent production fix |

### Commit message format
```
<type>(<scope>): <short description>

[optional body]

[optional footer(s)]
```

**Allowed types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`.

**Scopes:** service names (`auth`, `editor`, `ai`, `formatting`, `marketplace`, `wallet`, `content`, `feed`, `notification`), or areas (`infra`, `db`, `docs`, `ci`).

Example:
```
feat(wallet): enforce available-balance check on payout request

Adds a guard in POST /wallet/payouts/request that rejects requests
exceeding balance_available_cents. Returns 422 with structured
error body.

Closes #142
```

---

## Pull Request Process

1. **Title** follows Conventional Commits.
2. **Description** includes:
   - What changed and why
   - Screenshots or cURL examples for UI/API changes
   - Migration / breaking change notes (if any)
3. **Checks that must pass** before review:
   - CI: lint, unit tests, build, security scan
   - At least one approving review from a code owner
   - No merge conflicts
4. **Merge strategy:** Squash-and-merge into `main`.
5. **After merge:** The CD pipeline deploys to staging automatically. Production deploy requires a manual approval gate.

---

## Reporting Issues

- **Bug reports:** Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include reproduction steps, environment, and logs.
- **Feature requests:** Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md). Describe the problem first, then the proposed solution.
- **Security issues:** **Do not open a public issue.** Email `security@upp.local`.

---

## License

**Proprietary.** All rights reserved. Unauthorized copying, modification, or distribution is prohibited. For licensing inquiries contact `legal@upp.local`.

---

**Maintainers:** Platform Engineering Team
**Last reviewed:** 2026-11