.PHONY: help build test test-race test-cover lint fmt vet run dev migrate clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build:
	CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o ./bin/feed-service ./cmd

test:
	go test -v ./...

test-race:
	go test -race -v ./...

test-cover:
	go test -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

lint:
	@which golangci-lint > /dev/null || (echo "Install golangci-lint" && exit 1)
	golangci-lint run ./...

fmt:
	go fmt ./...

vet:
	go vet ./...

run:
	go run ./cmd

dev:
	@which air > /dev/null || go install github.com/air-verse/air@latest
	air

migrate:
	@echo "Applying migrations to $$DATABASE_URL..."
	@go run ./scripts/migrate

clean:
	go clean
	@rm -rf bin/ coverage.out coverage.html