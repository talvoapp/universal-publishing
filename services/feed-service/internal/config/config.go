// Package config loads and validates environment variables for feed-service.
package config

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/caarlos0/env/v10"
)

// Config is the fully-resolved, validated configuration.
type Config struct {
	// Runtime
	Env      string `env:"NODE_ENV" envDefault:"development"`
	Port     int    `env:"PORT" envDefault:"4007"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	TZ       string `env:"TZ" envDefault:"UTC"`

	// PostgreSQL (follow graph + posts metadata)
	DatabaseURL              string        `env:"DATABASE_URL,required"`
	DatabasePoolMin          int           `env:"DATABASE_POOL_MIN" envDefault:"2"`
	DatabasePoolMax          int           `env:"DATABASE_POOL_MAX" envDefault:"20"`
	DatabaseStatementTimeout time.Duration `env:"DATABASE_STATEMENT_TIMEOUT" envDefault:"30s"`
	DatabaseSSL              bool          `env:"DATABASE_SSL" envDefault:"false"`

	// Redis (timelines)
	RedisURL       string `env:"REDIS_URL,required"`
	RedisKeyPrefix string `env:"REDIS_KEY_PREFIX" envDefault:"feed:"`

	// Kafka consumer (DraftPublished events) — SASL/SSL for ntail
	KafkaBrokers          string `env:"KAFKA_BROKERS" envDefault:"localhost:9092"`
	KafkaSecurityProtocol string `env:"KAFKA_SECURITY_PROTOCOL" envDefault:""`
	KafkaSASLMechanism    string `env:"KAFKA_SASL_MECHANISM" envDefault:""`
	KafkaSASLUsername     string `env:"KAFKA_SASL_USERNAME" envDefault:""`
	KafkaSASLPassword     string `env:"KAFKA_SASL_PASSWORD" envDefault:""`
	KafkaOutboxTopic      string `env:"KAFKA_TOPIC_OUTBOX" envDefault:"upp.outbox.events"`
	KafkaConsumerGroup    string `env:"KAFKA_CONSUMER_GROUP" envDefault:"feed-service"`
	KafkaClientID         string `env:"KAFKA_CLIENT_ID" envDefault:"feed-service"`

	// JWT (verify tokens from auth-service)
	JWTSecret   string `env:"JWT_SECRET,required"`
	JWTIssuer   string `env:"JWT_ISSUER" envDefault:"upp-auth"`
	JWTAudience string `env:"JWT_AUDIENCE" envDefault:"upp-platform"`

	// CORS
	CORSOrigins string `env:"CORS_ORIGINS" envDefault:"http://localhost:3000,http://localhost:3001"`

	// Rate limiting
	RateLimitWindow time.Duration `env:"RATE_LIMIT_WINDOW" envDefault:"1m"`
	RateLimitMax    int           `env:"RATE_LIMIT_MAX" envDefault:"120"`

	// Hybrid fan-out strategy
	CelebrityThreshold int `env:"CELEBRITY_THRESHOLD" envDefault:"1000"`
	TimelineMaxSize    int `env:"TIMELINE_MAX_SIZE" envDefault:"1000"`
	TimelineFanoutCap  int `env:"TIMELINE_FANOUT_CAP" envDefault:"10000"`

	// Feed page size
	DefaultPageSize int `env:"DEFAULT_PAGE_SIZE" envDefault:"20"`
	MaxPageSize     int `env:"MAX_PAGE_SIZE" envDefault:"50"`

	// Observability
	OtelEndpoint   string `env:"OTEL_EXPORTER_OTLP_ENDPOINT" envDefault:""`
	ServiceName    string `env:"SERVICE_NAME" envDefault:"feed-service"`
	ServiceVersion string `env:"SERVICE_VERSION" envDefault:"1.0.0"`
}

// Load parses env vars, validates, returns Config.
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
	if len(c.JWTSecret) < 32 {
		return fmt.Errorf("JWT_SECRET must be at least 32 characters (got %d)", len(c.JWTSecret))
	}
	if !strings.HasPrefix(c.DatabaseURL, "postgres://") && !strings.HasPrefix(c.DatabaseURL, "postgresql://") {
		return fmt.Errorf("DATABASE_URL must start with postgres:// or postgresql://")
	}
	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return fmt.Errorf("REDIS_URL must start with redis:// or rediss://")
	}
	if c.CelebrityThreshold < 10 || c.CelebrityThreshold > 10_000_000 {
		return fmt.Errorf("CELEBRITY_THRESHOLD must be between 10 and 10,000,000 (got %d)", c.CelebrityThreshold)
	}
	if c.TimelineMaxSize < 100 || c.TimelineMaxSize > 100_000 {
		return fmt.Errorf("TIMELINE_MAX_SIZE must be between 100 and 100,000 (got %d)", c.TimelineMaxSize)
	}
	if c.TimelineFanoutCap < 100 || c.TimelineFanoutCap > 1_000_000 {
		return fmt.Errorf("TIMELINE_FANOUT_CAP must be between 100 and 1,000,000 (got %d)", c.TimelineFanoutCap)
	}
	if c.DefaultPageSize < 1 || c.MaxPageSize < c.DefaultPageSize || c.MaxPageSize > 200 {
		return fmt.Errorf("invalid page size config: default=%d max=%d", c.DefaultPageSize, c.MaxPageSize)
	}
	if c.DatabasePoolMin < 0 || c.DatabasePoolMax < c.DatabasePoolMin || c.DatabasePoolMax > 200 {
		return fmt.Errorf("invalid database pool config: min=%d max=%d", c.DatabasePoolMin, c.DatabasePoolMax)
	}
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("PORT must be between 1 and 65535")
	}
	// Kafka SASL validation
	if c.KafkaSecurityProtocol != "" && c.KafkaSecurityProtocol != "PLAINTEXT" {
		if c.KafkaSASLUsername == "" || c.KafkaSASLPassword == "" {
			return fmt.Errorf(
				"KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required when KAFKA_SECURITY_PROTOCOL=%s",
				c.KafkaSecurityProtocol,
			)
		}
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

// KafkaSASLEnabled returns true if SASL/SSL should be enabled.
func (c *Config) KafkaSASLEnabled() bool {
	return c.KafkaSecurityProtocol == "SASL_SSL" || c.KafkaSecurityProtocol == "SASL_PLAINTEXT"
}