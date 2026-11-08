# syntax=docker/dockerfile:1.7
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 GOOS=linux go build \
      -ldflags="-s -w -extldflags=-static" \
      -trimpath \
      -o /build/content-service \
      ./cmd

FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /build/content-service /content-service

USER 10001:10001
EXPOSE 4006

ENTRYPOINT ["/content-service"]