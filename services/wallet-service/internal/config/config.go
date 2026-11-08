// Package config loads and validates all environment variables for the
// wallet service. Fails fast on missing/malformed values.
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
	Env      string `env:"NODE_ENV" envDefault:"development"`
	Port     int    `env:"PORT" envDefault:"4005"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	TZ       string `env:"TZ" envDefault:"UTC"`

	// PostgreSQL (wallet_db)
	DatabaseURL              string        `env:"DATABASE_URL,required"`
	DatabasePoolMin          int           `env:"DATABASE_POOL_MIN" envDefault:"2"`
	DatabasePoolMax          int           `env:"DATABASE_POOL_MAX" envDefault:"20"`
	DatabaseStatementTimeout time.Duration `env:"DATABASE_STATEMENT_TIMEOUT" envDefault:"30s"`

	// Redis (db 6 — wallet)
	RedisURL       string `env:"REDIS_URL,required"`
	RedisKeyPrefix string `env:"REDIS_KEY_PREFIX" envDefault:"wallet:"`

	// Kafka consumer (reads OrderPaid + RefundIssued)
	KafkaBrokers    string `env:"KAFKA_BROKERS" envDefault:"kafka:9092"`
	KafkaOutboxTopic string `env:"KAFKA_TOPIC_OUTBOX" envDefault:"upp.outbox.events"`
	KafkaConsumerGroup string `env:"KAFKA_CONSUMER_GROUP" envDefault:"wallet-service"`
	KafkaClientID   string `env:"KAFKA_CLIENT_ID" envDefault:"wallet-service"`

	// JWT (verify tokens from auth-service)
	JWTSecret   string `env:"JWT_SECRET,required"`
	JWTIssuer   string `env:"JWT_ISSUER" envDefault:"upp-auth"`
	JWTAudience string `env:"JWT_AUDIENCE" envDefault:"upp-platform"`

	// CORS
	CORSOrigins string `env:"CORS_ORIGINS" envDefault:"http://localhost:3000,http://localhost:3001"`

	// Rate limiting
	RateLimitWindow time.Duration `env:"RATE_LIMIT_WINDOW" envDefault:"1m"`
	RateLimitMax    int           `env:"RATE_LIMIT_MAX" envDefault:"100"`

	// Stripe (Connect payouts)
	StripeSecretKey string `env:"STRIPE_SECRET_KEY,required"`

	// Payout behavior
	PayoutMinimumCents    int64         `env:"PAYOUT_MINIMUM_CENTS" envDefault:"1000"`  // $10
	PayoutDelayDays       int           `env:"PAYOUT_DELAY_DAYS" envDefault:"7"`       // T+7
	PayoutMaximumCents    int64         `env:"PAYOUT_MAXIMUM_CENTS" envDefault:"1000000"` // $10,000

	// Platform economics
	PlatformFeePercent float64 `env:"STRIPE_PLATFORM_FEE_PERCENT" envDefault:"15"`

	// Observability
	OtelEndpoint   string `env:"OTEL_EXPORTER_OTLP_ENDPOINT" envDefault:""`
	ServiceName    string `env:"SERVICE_NAME" envDefault:"wallet-service"`
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

// MustLoad calls Load and exits on failure.
func MustLoad() *Config {
	cfg, err := Load()
	if err != nil {
		log.Fatalf("[CONFIG] %v", err)
	}
	return cfg
}

func (c *Config) validate() error {
	// JWT secret length
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("JWT_SECRET must be at least 32 characters (got %d)", len(c.JWTSecret))
	}

	// Postgres URL
	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		return fmt.Errorf("DATABASE_URL must start with postgres:// or postgresql://")
	}

	// Redis URL
	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return fmt.Errorf("REDIS_URL must start with redis:// or rediss://")
	}

	// Stripe key format
	if !strings.HasPrefix(c.StripeSecretKey, "sk_") {
		return fmt.Errorf("STRIPE_SECRET_KEY must start with sk_")
	}

	// Platform fee sanity
	if c.PlatformFeePercent < 0 || c.PlatformFeePercent > 50 {
		return fmt.Errorf("STRIPE_PLATFORM_FEE_PERCENT must be between 0 and 50")
	}

	// Payout policy sanity
	if c.PayoutMinimumCents < 100 {
		return fmt.Errorf("PAYOUT_MINIMUM_CENTS must be >= 100 (1 dollar)")
	}
	if c.PayoutMaximumCents <= c.PayoutMinimumCents {
		return fmt.Errorf("PAYOUT_MAXIMUM_CENTS must be > PAYOUT_MINIMUM_CENTS")
	}
	if c.PayoutDelayDays < 0 || c.PayoutDelayDays > 90 {
		return fmt.Errorf("PAYOUT_DELAY_DAYS must be between 0 and 90")
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

func (c *Config) IsProd() bool { return c.Env == "production" }
func (c *Config) IsDev() bool  { return c.Env == "development" }

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