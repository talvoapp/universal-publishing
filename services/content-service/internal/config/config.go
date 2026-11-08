// Package config loads and validates environment variables for
// content-service. Fails fast on missing/malformed values.
//
// NOTE ON DUAL STORAGE:
//   content-service reads from BOTH:
//     - MongoDB  → content (articles, books, chapters)
//     - PostgreSQL → entitlement data (purchases, subscriptions)
//
// Both must be reachable for the service to be ready.
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
	Port     int    `env:"PORT" envDefault:"4006"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	TZ       string `env:"TZ" envDefault:"UTC"`

	// PostgreSQL (marketplace_db — entitlement data lives here)
	DatabaseURL              string        `env:"DATABASE_URL,required"`
	DatabasePoolMin          int           `env:"DATABASE_POOL_MIN" envDefault:"2"`
	DatabasePoolMax          int           `env:"DATABASE_POOL_MAX" envDefault:"20"`
	DatabaseStatementTimeout time.Duration `env:"DATABASE_STATEMENT_TIMEOUT" envDefault:"30s"`

	// MongoDB (upp_editor — content lives here)
	MongoURL                     string        `env:"MONGO_URL,required"`
	MongoDBName                  string        `env:"MONGO_DB_NAME" envDefault:"upp_editor"`
	MongoMaxPool                 int           `env:"MONGO_MAX_POOL" envDefault:"20"`
	MongoServerSelectionTimeout  time.Duration `env:"MONGO_SERVER_SELECTION_TIMEOUT" envDefault:"5s"`

	// Redis (db 4 — entitlement cache)
	RedisURL       string `env:"REDIS_URL,required"`
	RedisKeyPrefix string `env:"REDIS_KEY_PREFIX" envDefault:"content:"`

	// JWT (verify access tokens from auth-service)
	JWTSecret   string `env:"JWT_SECRET,required"`
	JWTIssuer   string `env:"JWT_ISSUER" envDefault:"upp-auth"`
	JWTAudience string `env:"JWT_AUDIENCE" envDefault:"upp-platform"`

	// CORS
	CORSOrigins string `env:"CORS_ORIGINS" envDefault:"http://localhost:3000,http://localhost:3001"`

	// Rate limiting
	RateLimitWindow time.Duration `env:"RATE_LIMIT_WINDOW" envDefault:"1m"`
	RateLimitMax    int           `env:"RATE_LIMIT_MAX" envDefault:"100"`

	// Entitlement cache
	EntitlementCacheTTL time.Duration `env:"ENTITLEMENT_CACHE_TTL" envDefault:"5m"`

	// Preview behavior
	// When a user isn't entitled to full content, we return this
	// fraction of the chapter as a preview (e.g., 0.15 = first 15%).
	PreviewFraction float64 `env:"PREVIEW_FRACTION" envDefault:"0.15"`

	// Observability
	OtelEndpoint   string `env:"OTEL_EXPORTER_OTLP_ENDPOINT" envDefault:""`
	ServiceName    string `env:"SERVICE_NAME" envDefault:"content-service"`
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
	if !strings.HasPrefix(c.MongoURL, "mongodb://") && !strings.HasPrefix(c.MongoURL, "mongodb+srv://") {
		return fmt.Errorf("MONGO_URL must start with mongodb:// or mongodb+srv://")
	}
	if !strings.HasPrefix(c.RedisURL, "redis://") && !strings.HasPrefix(c.RedisURL, "rediss://") {
		return fmt.Errorf("REDIS_URL must start with redis:// or rediss://")
	}
	if c.PreviewFraction < 0 || c.PreviewFraction > 1 {
		return fmt.Errorf("PREVIEW_FRACTION must be between 0 and 1 (got %.2f)", c.PreviewFraction)
	}
	if c.EntitlementCacheTTL < 10*time.Second || c.EntitlementCacheTTL > 1*time.Hour {
		return fmt.Errorf("ENTITLEMENT_CACHE_TTL must be between 10s and 1h")
	}
	if c.DatabasePoolMin < 0 || c.DatabasePoolMax < c.DatabasePoolMin || c.DatabasePoolMax > 200 {
		return fmt.Errorf("invalid database pool config: min=%d max=%d", c.DatabasePoolMin, c.DatabasePoolMax)
	}
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