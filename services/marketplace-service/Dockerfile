# syntax=docker/dockerfile:1.7
# ============================================================
# Marketplace Service — Production Dockerfile (Go)
# ============================================================

# ------------------------------------------------------------
# STAGE 1: BUILDER
# ------------------------------------------------------------
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Copy dependency manifests first (better layer caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY cmd ./cmd
COPY internal ./internal

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -extldflags=-static" \
      -trimpath \
      -o /build/marketplace-service \
      ./cmd

# ------------------------------------------------------------
# STAGE 2: RUNTIME (scratch — ~15 MB)
# ------------------------------------------------------------
FROM scratch

# Copy CA certs + timezone data + the binary
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /build/marketplace-service /marketplace-service

# Non-root user (UID 10001)
USER 10001:10001

EXPOSE 4004

ENTRYPOINT ["/marketplace-service"]