module github.com/talvoapp/universal-publishing/content-service

go 1.22

require (
	// HTTP framework
	github.com/go-chi/chi/v5 v5.0.12
	github.com/go-chi/cors v1.2.1

	// PostgreSQL (entitlements + purchases)
	github.com/jackc/pgx/v5 v5.5.5
	github.com/jackc/pgx/v5/pgxpool v5.5.5

	// MongoDB (content/drafts from editor-service)
	go.mongodb.org/mongo-driver v1.15.1

	// Redis (entitlement cache + rate limits)
	github.com/redis/go-redis/v9 v9.5.1

	// Config + validation
	github.com/caarlos0/env/v10 v10.0.0

	// JWT
	github.com/golang-jwt/jwt/v5 v5.2.1

	// Observability
	github.com/prometheus/client_golang v1.19.1
	go.opentelemetry.io/otel v1.27.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp v1.27.0
	go.opentelemetry.io/otel/sdk v1.27.0
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.52.0

	// Logging
	go.uber.org/zap v1.27.0

	// Utilities
	github.com/google/uuid v1.6.0
)