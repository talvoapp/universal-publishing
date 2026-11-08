// Package utils provides shared helpers (logging, errors, conversions).
package utils

import (
	"context"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// loggerKey is the context key for the request-scoped logger.
type loggerKey struct{}

// WithLogger attaches a logger to the context.
func WithLogger(ctx context.Context, log *zap.Logger) context.Context {
	return context.WithValue(ctx, loggerKey{}, log)
}

// LoggerFromCtx returns the logger attached to the context, or a no-op
// logger if none is present.
func LoggerFromCtx(ctx context.Context) *zap.Logger {
	if log, ok := ctx.Value(loggerKey{}).(*zap.Logger); ok && log != nil {
		return log
	}
	return zap.NewNop()
}

// ParseLogLevel converts a string level to zapcore.Level.
func ParseLogLevel(s string) zapcore.Level {
	switch s {
	case "debug":
		return zapcore.DebugLevel
	case "info":
		return zapcore.InfoLevel
	case "warn":
		return zapcore.WarnLevel
	case "error":
		return zapcore.ErrorLevel
	case "fatal":
		return zapcore.FatalLevel
	default:
		return zapcore.InfoLevel
	}
}

// NewLogger builds a zap logger for the given environment.
// Production → JSON. Development → console with color.
func NewLogger(env, level string) (*zap.Logger, error) {
	lvl := ParseLogLevel(level)

	if env == "production" {
		cfg := zap.NewProductionConfig()
		cfg.Level = zap.NewAtomicLevelAt(lvl)
		cfg.EncoderConfig.TimeKey = "time"
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		return cfg.Build()
	}

	cfg := zap.NewDevelopmentConfig()
	cfg.Level = zap.NewAtomicLevelAt(lvl)
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
	cfg.DisableCaller = true
	return cfg.Build()
}