# ============================================================
# Marketplace Service — Development commands
# ============================================================
.PHONY: help build test test-race lint fmt vet run dev migrate clean

# ------------------------------------------------------------
# HELP
# ------------------------------------------------------------
help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------
# BUILD
# ------------------------------------------------------------
build: ## Build the binary
	@echo "→ Building binary..."
	CGO_ENABLED=0 go build -ldflags="-s -w -extldflags=-static" -trimpath -o ./bin/marketplace-service ./cmd

build-linux: ## Cross-compile for Linux (for Docker)
	@echo "→ Building for linux/amd64..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -trimpath -o ./bin/marketplace-service-linux ./cmd

# ------------------------------------------------------------
# TEST
# ------------------------------------------------------------
test: ## Run unit tests
	@echo "→ Running tests..."
	go test -v ./...

test-race: ## Run tests with race detector
	go test -race -v ./...

test-cover: ## Run tests with coverage
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html
	@echo "→ Coverage report: coverage.html"

# ------------------------------------------------------------
# QUALITY
# ------------------------------------------------------------
lint: ## Run golangci-lint
	@which golangci-lint > /dev/null || (echo "Install golangci-lint: brew install golangci-lint" && exit 1)
	golangci-lint run ./...

fmt: ## Format code
	go fmt ./...

vet: ## Run go vet
	go vet ./...

# ------------------------------------------------------------
# RUN
# ------------------------------------------------------------
run: ## Run the binary (requires .env)
	go run ./cmd

dev: ## Run with hot-reload (requires air)
	@which air > /dev/null || go install github.com/air-verse/air@latest
	air

# ------------------------------------------------------------
# DATABASE
# ------------------------------------------------------------
migrate: ## Run migrations against local Postgres
	@echo "→ Running migrations..."
	@for f in internal/db/migrations/*.sql; do \
		echo "  → $$f"; \
		psql "$$DATABASE_URL" -f "$$f"; \
	done

# ------------------------------------------------------------
# CLEAN
# ------------------------------------------------------------
clean: ## Remove build artifacts
	rm -rf bin/ tmp/ coverage.out coverage.html