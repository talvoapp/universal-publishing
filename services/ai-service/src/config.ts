/**
 * Centralized configuration for ai-service.
 *
 * Beyond the usual runtime/DB vars, ai-service has:
 *   - Provider credentials (OpenAI, Anthropic)
 *   - Model selection per operation
 *   - Tier-based token quotas
 *   - SSE streaming behavior
 *   - Quota reset windows
 *   - Fallback + retry policy
 *
 * Design note on quotas:
 *   - Free tier:      5,000 tokens / day
 *   - Premium tier:   100,000 tokens / day
 *   - Admin tier:     1,000,000 tokens / day (configurable)
 *
 *   The actual counter lives in Redis (`ai:quota:{userId}:{yyyy-mm-dd}`),
 *   with TTL = 24h. Quotas are enforced BEFORE each request by the
 *   middleware, and INCREMENTED after each successful call (based on
 *   actual token usage reported by the provider).
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

// ============================================================
// PRIMITIVES
// ============================================================
const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'TRUE', 'FALSE', 'YES', 'NO'])
  .transform((v) => ['true', '1', 'yes'].includes(v.toLowerCase()));

const intString = (min: number, max: number, def: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .transform((v) => parseInt(v, 10))
    .refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`)
    .default(String(def));

const portNumber = intString(1, 65535, 4003);

const durationMs = (min: number, max: number, def: number) => intString(min, max, def);

// ============================================================
// PROVIDER CONFIG
// ============================================================
const PROVIDERS = ['openai', 'anthropic'] as const;
type Provider = (typeof PROVIDERS)[number];

// ============================================================
// SCHEMA
// ============================================================
const envSchema = z.object({
  // -------- Runtime --------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: portNumber,
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TZ: z.string().default('UTC'),

  // -------- Redis --------
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('ai:'),

  // -------- JWT --------
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('upp-auth'),
  JWT_AUDIENCE: z.string().default('upp-platform'),

  // -------- CORS --------
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  // -------- Rate limiting --------
  RATE_LIMIT_WINDOW_MS: intString(1000, 3_600_000, 60_000),
  RATE_LIMIT_MAX_REQUESTS: intString(1, 10_000, 100),

  // -------- Providers --------
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_MAX_OUTPUT_TOKENS: intString(64, 32_000, 4_096),
  OPENAI_TIMEOUT_MS: intString(5_000, 300_000, 60_000),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-latest'),
  ANTHROPIC_MAX_OUTPUT_TOKENS: intString(64, 32_000, 4_096),
  ANTHROPIC_TIMEOUT_MS: intString(5_000, 300_000, 60_000),

  AI_PRIMARY_PROVIDER: z.enum(PROVIDERS).default('openai'),
  AI_FALLBACK_PROVIDER: z.enum(PROVIDERS).default('anthropic'),
  AI_ENABLE_FALLBACK: booleanString.default('true'),

  // -------- Quotas --------
  AI_FREE_TIER_DAILY_TOKENS: intString(100, 10_000_000, 5_000),
  AI_PREMIUM_TIER_DAILY_TOKENS: intString(100, 100_000_000, 100_000),
  AI_ADMIN_TIER_DAILY_TOKENS: intString(100, 1_000_000_000, 1_000_000),
  AI_QUOTA_WINDOW_HOURS: intString(1, 168, 24),
  AI_QUOTA_WARNING_THRESHOLD: intString(50, 100, 80), // warn at 80%

  // -------- SSE / Session --------
  SSE_HEARTBEAT_INTERVAL_MS: intString(1_000, 60_000, 15_000),
  SSE_SESSION_TTL_SECONDS: intString(60, 3_600, 600), // 10 min resume window
  SSE_MAX_STREAM_DURATION_MS: intString(10_000, 600_000, 180_000), // 3 min hard cap
  SSE_MAX_OUTPUT_CHARS: intString(100, 500_000, 50_000),

  // -------- Retry --------
  AI_MAX_RETRIES: intString(0, 5, 2),
  AI_RETRY_BASE_DELAY_MS: intString(100, 10_000, 500),

  // -------- Observability --------
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SERVICE_NAME: z.string().default('ai-service'),
  SERVICE_VERSION: z.string().default('1.0.0'),
});

// ============================================================
// PARSE
// ============================================================
type RawEnv = z.infer<typeof envSchema>;

function parseEnv(): RawEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ✗ ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(
      `\n[CONFIG] Environment validation failed:\n${issues}\n\n` +
        `Check your .env file or container environment variables.\n`,
    );
    process.exit(1);
  }

  // Cross-field validation: at least one provider must be configured.
  const hasOpenAI = Boolean(result.data.OPENAI_API_KEY);
  const hasAnthropic = Boolean(result.data.ANTHROPIC_API_KEY);
  if (!hasOpenAI && !hasAnthropic) {
    // eslint-disable-next-line no-console
    console.error(
      '\n[CONFIG] At least one of OPENAI_API_KEY or ANTHROPIC_API_KEY must be set.\n',
    );
    process.exit(1);
  }

  // If primary provider has no key, flip to whichever one does.
  if (
    result.data.AI_PRIMARY_PROVIDER === 'openai' && !hasOpenAI &&
    result.data.AI_ENABLE_FALLBACK && hasAnthropic
  ) {
    // eslint-disable-next-line no-console
    console.warn('[CONFIG] OpenAI key missing; using Anthropic as primary');
    result.data.AI_PRIMARY_PROVIDER = 'anthropic';
    result.data.AI_FALLBACK_PROVIDER = 'openai';
  } else if (
    result.data.AI_PRIMARY_PROVIDER === 'anthropic' && !hasAnthropic &&
    result.data.AI_ENABLE_FALLBACK && hasOpenAI
  ) {
    // eslint-disable-next-line no-console
    console.warn('[CONFIG] Anthropic key missing; using OpenAI as primary');
    result.data.AI_PRIMARY_PROVIDER = 'openai';
    result.data.AI_FALLBACK_PROVIDER = 'anthropic';
  } else if (
    result.data.AI_PRIMARY_PROVIDER === 'openai' && !hasOpenAI
  ) {
    // eslint-disable-next-line no-console
    console.error('[CONFIG] OPENAI_API_KEY missing but primary provider is OpenAI.\n');
    process.exit(1);
  } else if (
    result.data.AI_PRIMARY_PROVIDER === 'anthropic' && !hasAnthropic
  ) {
    // eslint-disable-next-line no-console
    console.error('[CONFIG] ANTHROPIC_API_KEY missing but primary provider is Anthropic.\n');
    process.exit(1);
  }

  return result.data;
}

const raw = parseEnv();

// ============================================================
// EXPORT
// ============================================================
export const config = Object.freeze({
  // ----- Runtime -----
  env: raw.NODE_ENV,
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  isProd: raw.NODE_ENV === 'production',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  tz: raw.TZ,
  serviceName: raw.SERVICE_NAME,
  serviceVersion: raw.SERVICE_VERSION,

  // ----- Redis -----
  redis: Object.freeze({
    url: raw.REDIS_URL,
    keyPrefix: raw.REDIS_KEY_PREFIX,
  }),

  // ----- JWT -----
  jwt: Object.freeze({
    secret: raw.JWT_SECRET,
    issuer: raw.JWT_ISSUER,
    audience: raw.JWT_AUDIENCE,
  }),

  // ----- CORS -----
  cors: Object.freeze({
    origins: raw.CORS_ORIGINS,
  }),

  // ----- HTTP rate limiting -----
  rateLimit: Object.freeze({
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX_REQUESTS,
  }),

  // ----- Providers -----
  providers: Object.freeze({
    openai: raw.OPENAI_API_KEY
      ? Object.freeze({
          apiKey: raw.OPENAI_API_KEY,
          model: raw.OPENAI_MODEL,
          maxOutputTokens: raw.OPENAI_MAX_OUTPUT_TOKENS,
          timeoutMs: raw.OPENAI_TIMEOUT_MS,
        })
      : null,
    anthropic: raw.ANTHROPIC_API_KEY
      ? Object.freeze({
          apiKey: raw.ANTHROPIC_API_KEY,
          model: raw.ANTHROPIC_MODEL,
          maxOutputTokens: raw.ANTHROPIC_MAX_OUTPUT_TOKENS,
          timeoutMs: raw.ANTHROPIC_TIMEOUT_MS,
        })
      : null,
    primary: raw.AI_PRIMARY_PROVIDER,
    fallback: raw.AI_FALLBACK_PROVIDER,
    enableFallback: raw.AI_ENABLE_FALLBACK,
  }),

  // ----- Quotas -----
  quotas: Object.freeze({
    tiers: Object.freeze({
      free: raw.AI_FREE_TIER_DAILY_TOKENS,
      premium: raw.AI_PREMIUM_TIER_DAILY_TOKENS,
      admin: raw.AI_ADMIN_TIER_DAILY_TOKENS,
    }),
    windowHours: raw.AI_QUOTA_WINDOW_HOURS,
    warningThresholdPct: raw.AI_QUOTA_WARNING_THRESHOLD,
  }),

  // ----- SSE -----
  sse: Object.freeze({
    heartbeatIntervalMs: raw.SSE_HEARTBEAT_INTERVAL_MS,
    sessionTtlSeconds: raw.SSE_SESSION_TTL_SECONDS,
    maxStreamDurationMs: raw.SSE_MAX_STREAM_DURATION_MS,
    maxOutputChars: raw.SSE_MAX_OUTPUT_CHARS,
  }),

  // ----- Retry -----
  retry: Object.freeze({
    maxRetries: raw.AI_MAX_RETRIES,
    baseDelayMs: raw.AI_RETRY_BASE_DELAY_MS,
  }),

  // ----- Observability -----
  observability: Object.freeze({
    otlpEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: raw.SENTRY_DSN,
  }),
});

export type AppConfig = typeof config;
export type ProviderName = Provider;