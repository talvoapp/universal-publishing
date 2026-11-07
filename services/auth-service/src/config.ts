/**
 * Centralized configuration loader & validator.
 *
 * Loads all environment variables once at startup, validates them with Zod,
 * and exports a frozen typed object. Any missing or malformed required
 * variable causes the process to exit immediately with a clear error —
 * "fail fast, fail loud" is the rule.
 *
 * Usage:
 *   import { config } from '@/config';
 *   config.database.url      // typed as string
 *   config.jwt.accessExpiry  // typed as string
 */

import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env (no-op in production where env vars are injected by orchestrator)
loadDotenv();

// ============================================================
// SCHEMA
// ============================================================

/**
 * Booleans come in as strings from the environment; parse them explicitly.
 * Accepts: "true"|"1"|"yes" (case-insensitive) → true, anything else → false.
 */
const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'TRUE', 'FALSE', 'YES', 'NO'])
  .transform((v) => ['true', '1', 'yes'].includes(v.toLowerCase()));

/**
 * Ports are positive integers ≤ 65535.
 */
const portNumber = z
  .string()
  .regex(/^\d+$/, 'must be a numeric port')
  .transform((v) => parseInt(v, 10))
  .refine((n) => n > 0 && n <= 65535, 'port must be between 1 and 65535');

/**
 * A duration string like "15m", "7d", "1h30m". Regex covers the common cases.
 */
const durationString = z
  .string()
  .regex(/^\d+(s|m|h|d|w)$/i, 'must be a duration like "15m", "7d", "1h"');

// ------------------------------------------------------------
// ENV SCHEMA
// ------------------------------------------------------------

const envSchema = z.object({
  // -------- Runtime --------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: portNumber.default('4001'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TZ: z.string().default('UTC'),

  // -------- PostgreSQL --------
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
      'must be a postgres:// URL',
    ),
  DATABASE_POOL_MIN: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .default('2'),
  DATABASE_POOL_MAX: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .default('10'),
  DATABASE_SSL: booleanString.default('false'),
  DATABASE_STATEMENT_TIMEOUT_MS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .default('30000'),

  // -------- Redis --------
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('auth:'),

  // -------- JWT --------
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters for security'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters for security'),
  JWT_ACCESS_EXPIRY: durationString.default('15m'),
  JWT_REFRESH_EXPIRY: durationString.default('7d'),
  JWT_ISSUER: z.string().default('upp-auth'),
  JWT_AUDIENCE: z.string().default('upp-platform'),

  // -------- Password hashing --------
  BCRYPT_ROUNDS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n >= 10 && n <= 15, 'BCRYPT_ROUNDS must be between 10 and 15')
    .default('12'),

  // -------- OAuth --------
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .default('http://localhost:8080/api/v1/oauth/google/callback'),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z
    .string()
    .url()
    .optional()
    .default('http://localhost:8080/api/v1/oauth/github/callback'),

  // -------- Email (SMTP) --------
  SMTP_HOST: z.string().default('mailhog'),
  SMTP_PORT: portNumber.default('1025'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: booleanString.default('false'),
  SMTP_FROM: z.string().email().default('noreply@upp.local'),

  // -------- CORS --------
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // -------- Rate limiting --------
  RATE_LIMIT_WINDOW_MS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .default('60000'),
  RATE_LIMIT_MAX_REQUESTS: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .default('100'),

  // -------- Observability --------
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SERVICE_NAME: z.string().default('auth-service'),
  SERVICE_VERSION: z.string().default('1.0.0'),
});

// ============================================================
// PARSE & VALIDATE
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

  return result.data;
}

const raw = parseEnv();

// ============================================================
// STRUCTURED EXPORT (grouped for readability)
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

  // ----- Database -----
  database: Object.freeze({
    url: raw.DATABASE_URL,
    poolMin: raw.DATABASE_POOL_MIN,
    poolMax: raw.DATABASE_POOL_MAX,
    ssl: raw.DATABASE_SSL,
    statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
  }),

  // ----- Redis -----
  redis: Object.freeze({
    url: raw.REDIS_URL,
    keyPrefix: raw.REDIS_KEY_PREFIX,
  }),

  // ----- JWT -----
  jwt: Object.freeze({
    secret: raw.JWT_SECRET,
    refreshSecret: raw.JWT_REFRESH_SECRET,
    accessExpiry: raw.JWT_ACCESS_EXPIRY,
    refreshExpiry: raw.JWT_REFRESH_EXPIRY,
    issuer: raw.JWT_ISSUER,
    audience: raw.JWT_AUDIENCE,
  }),

  // ----- Password -----
  password: Object.freeze({
    bcryptRounds: raw.BCRYPT_ROUNDS,
  }),

  // ----- OAuth -----
  oauth: Object.freeze({
    google: raw.GOOGLE_CLIENT_ID
      ? Object.freeze({
          clientId: raw.GOOGLE_CLIENT_ID,
          clientSecret: raw.GOOGLE_CLIENT_SECRET!,
          callbackUrl: raw.GOOGLE_CALLBACK_URL!,
        })
      : null,
    github: raw.GITHUB_CLIENT_ID
      ? Object.freeze({
          clientId: raw.GITHUB_CLIENT_ID,
          clientSecret: raw.GITHUB_CLIENT_SECRET!,
          callbackUrl: raw.GITHUB_CALLBACK_URL!,
        })
      : null,
  }),

  // ----- SMTP -----
  smtp: Object.freeze({
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    user: raw.SMTP_USER,
    password: raw.SMTP_PASSWORD,
    secure: raw.SMTP_SECURE,
    from: raw.SMTP_FROM,
  }),

  // ----- CORS -----
  cors: Object.freeze({
    origins: raw.CORS_ORIGINS,
  }),

  // ----- Rate limiting -----
  rateLimit: Object.freeze({
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX_REQUESTS,
  }),

  // ----- Observability -----
  observability: Object.freeze({
    otlpEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: raw.SENTRY_DSN,
  }),
});

export type AppConfig = typeof config;