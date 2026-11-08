// Package config loads and validates all environment variables for the
// marketplace service. Fails fast on missing/malformed values.
package config

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/caarlos0/env/v10"
)

// Config is the fully-resolved, validated configuration for the service.
type Config struct {
	// Runtime
	Env     string `env:"NODE_ENV" envDefault:"development"`
	Port    int    `env:"PORT" envDefault:"4004"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	TZ      string `env:"TZ" envDefault:"UTC"`

	// PostgreSQL
	DatabaseURL          string `env:"DATABASE_URL,required"`
	DatabasePoolMin      int    `env:"DATABASE_POOL_MIN" envDefault:"2"`
	DatabasePoolMax      int    `env:"DATABASE_POOL_MAX" envDefault:"20"`
	DatabaseStatementTimeout time.Duration `env:"DATABASE_STATEMENT_TIMEOUT" envDefault:"30s"`

	// Redis
	RedisURL       string `env:"REDIS_URL,required"`
	RedisKeyPrefix string `env:"REDIS_KEY_PREFIX" envDefault:"market:"`

	// Kafka
	KafkaBrokers   string `env:"KAFKA_BROKERS" envDefault:"kafka:9092"`
	KafkaOutboxTopic string `env:"KAFKA_TOPIC_OUTBOX" envDefault:"upp.outbox.events"`
	KafkaClientID  string `env:"KAFKA_CLIENT_ID" envDefault:"marketplace-service"`

	// JWT (verify tokens from auth-service)
	JWTSecret   string `env:"JWT_SECRET,required"`
	JWTIssuer   string `env:"JWT_ISSUER" envDefault:"upp-auth"`
	JWTAudience string `env:"JWT_AUDIENCE" envDefault:"upp-platform"`

	// CORS
	CORSOrigins string `env:"CORS_ORIGINS" envDefault:"http://localhost:3000,http://localhost:3001"`

	// Rate limiting
	RateLimitWindow time.Duration `env:"RATE_LIMIT_WINDOW" envDefault:"1m"`
	RateLimitMax    int           `env:"RATE_LIMIT_MAX" envDefault:"100"`

	// Stripe
	StripeSecretKey      string `env:"STRIPE_SECRET_KEY,required"`
	StripePublishableKey string `env:"STRIPE_PUBLISHABLE_KEY" envDefault:""`
	StripeWebhookSecret  string `env:"STRIPE_WEBHOOK_SECRET,required"`
	StripeConnectClientID string `env:"STRIPE_CONNECT_CLIENT_ID" envDefault:""`
	// PlatformFeePercent is the cut the platform keeps from each sale.
	PlatformFeePercent float64 `env:"STRIPE_PLATFORM_FEE_PERCENT" envDefault:"15"`

	// Checkout behavior
	CheckoutSessionExpiry time.Duration `env:"CHECKOUT_SESSION_EXPIRY" envDefault:"1h"`

	// Idempotency
	IdempotencyTTL time.Duration `env:"IDEMPOTENCY_TTL" envDefault:"24h"`

	// Observability
	OtelEndpoint   string `env:"OTEL_EXPORTER_OTLP_ENDPOINT" envDefault:""`
	ServiceName    string `env:"SERVICE_NAME" envDefault:"marketplace-service"`
	ServiceVersion string `env:"SERVICE_VERSION" envDefault:"1.0.0"`
}

// Load parses env vars, validates, and returns Config.
func Load() (*Config, error) {
	cfg := &Config{}
	if err := env.Parse(cfg); err != nil {
		return nil, fmt.Errorf("parse env: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("validate config: %w", err)
	}

	return cfg, nil
}

// MustLoad calls Load and exits on failure. Convenience for main().
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		log.Fatalf("[CONFIG] %v", err)
	}
	return cfg
}

// validate applies cross-field and value constraints beyond env tags.
func (c *Config) validate() error {
	// JWT secret length — mirrors auth-service policy
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("JWT_SECRET must be at least 32 characters (got %d)", len(c.JWTSecret))
	}

	// PostgreSQL URL
	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		return fmt.Errorf("DATABASE_URL must start with postgres:// or postgresql://")
	}

	// Redis URL
	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return fmt.Errorf("REDIS_URL must start with redis:// or rediss://")
	}

	// Stripe keys must look like Stripe keys
	if !strings.HasPrefix(c.StripeSecretKey, "sk_") {
		return fmt.Errorf("STRIPE_SECRET_KEY must start with sk_")
	}
	if !strings.HasPrefix(c.StripeWebhookSecret, "whsec_") {
		return fmt.Errorf("STRIPE_WEBHOOK_SECRET must start with whsec_")
	}

	// Platform fee in [0, 50]%
	if c.PlatformFeePercent < 0 || c.PlatformFeePercent > 50 {
		return fmt.Errorf("STRIPE_PLATFORM_FEE_PERCENT must be between 0 and 50")
	}

	// Pool sanity
	if c.DatabasePoolMin < 0 || c.DatabasePoolMax < c.DatabasePoolMin || c.DatabasePoolMax > 200 {
		return fmt.Errorf("invalid database pool config: min=%d max=%d", c.DatabasePoolMin, c.DatabasePoolMax)
	}

	// Port
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("PORT must be between 1 and 65535")
	}

	return nil
}

// IsProd returns true if running in production.
func (c *Config) IsProd() bool { return c.Env == "production" }

// IsDev returns true if running in development.
func (c *Config) IsDev() bool { return c.Env == "development" }

// CORSOriginsList splits CORS_ORIGINS into a slice.
func (c *Config) CORSOriginsList() []string {
	parts := strings.Split(c.CORSOrigins, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// KafkaBrokerList splits KAFKA_BROKERS into a slice.
func (c *Config) KafkaBrokerList() []string {
	parts := strings.Split(c.KafkaBrokers, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}