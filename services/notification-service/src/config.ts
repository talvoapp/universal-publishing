/**
 * Centralized configuration for notification-service.
 *
 * Required env vars are validated at startup. Missing/malformed → exit(1).
 *
 * The service consumes Kafka events and dispatches notifications via:
 *   - SMTP (email)
 *   - FCM (mobile push — stubbed in v1)
 *   - In-app DB (Postgres `notifications` table)
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

const portNumber = intString(1, 65535, 4008);

// ============================================================
// SCHEMA
// ============================================================
const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: portNumber,
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  TZ: z.string().default('UTC'),

  // PostgreSQL (notifications inbox + processed events)
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
      'must be a postgres:// URL',
    ),
  DATABASE_POOL_MIN: intString(1, 100, 2),
  DATABASE_POOL_MAX: intString(1, 200, 10),
  DATABASE_SSL: booleanString.default('false'),

  // Redis (TLS via rediss://)
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('notify:'),

  // Kafka (with SASL/SSL for ntail)
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_SECURITY_PROTOCOL: z.string().default(''),
  KAFKA_SASL_MECHANISM: z.string().default(''),
  KAFKA_SASL_USERNAME: z.string().default(''),
  KAFKA_SASL_PASSWORD: z.string().default(''),
  KAFKA_TOPIC_OUTBOX: z.string().default('upp.outbox.events'),
  KAFKA_CONSUMER_GROUP: z.string().default('notification-service'),
  KAFKA_CLIENT_ID: z.string().default('notification-service'),

  // SMTP — allow empty host (disabled mode → log only)
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: portNumber.default('587'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: booleanString.default('false'),
  SMTP_FROM: z.string().email().default('noreply@upp.local'),
  SMTP_FROM_NAME: z.string().default('Universal Publishing'),

  // Email behavior
  EMAIL_MAX_RETRIES: intString(0, 10, 3),
  EMAIL_RETRY_BASE_MS: intString(100, 60_000, 1000),
  EMAIL_RATE_LIMIT_PER_HOUR: intString(1, 10_000, 100),

  // In-app notifications
  IN_APP_RETENTION_DAYS: intString(1, 365, 90),

  // Auth service (for looking up user emails)
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:4001'),
    // Feed service (for follower lookups)
  FEED_SERVICE_URL: z.string().url().default('http://localhost:4007'),


  // Frontend (for CTA links in emails)
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_PROTOCOL: z.string().default('http/protobuf'),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SERVICE_NAME: z.string().default('notification-service'),
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

  // Cross-field validation
  const data = result.data;

  if (data.KAFKA_SECURITY_PROTOCOL && data.KAFKA_SECURITY_PROTOCOL !== 'PLAINTEXT') {
    if (!data.KAFKA_SASL_USERNAME || !data.KAFKA_SASL_PASSWORD) {
      // eslint-disable-next-line no-console
      console.error(
        `\n[CONFIG] KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required when KAFKA_SECURITY_PROTOCOL=${data.KAFKA_SECURITY_PROTOCOL}\n`,
      );
      process.exit(1);
    }
  }

  return data;
}

const raw = parseEnv();

// ============================================================
// EXPORT
// ============================================================
export const config = Object.freeze({
  // Runtime
  env: raw.NODE_ENV,
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  isProd: raw.NODE_ENV === 'production',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,
  tz: raw.TZ,
  serviceName: raw.SERVICE_NAME,
  serviceVersion: raw.SERVICE_VERSION,

  // Database
  database: Object.freeze({
    url: raw.DATABASE_URL,
    poolMin: raw.DATABASE_POOL_MIN,
    poolMax: raw.DATABASE_POOL_MAX,
    ssl: raw.DATABASE_SSL,
  }),

  // Redis
  redis: Object.freeze({
    url: raw.REDIS_URL,
    keyPrefix: raw.REDIS_KEY_PREFIX,
  }),

  // Kafka (with SASL config)
  kafka: Object.freeze({
    brokers: raw.KAFKA_BROKERS.split(',').map((s) => s.trim()).filter(Boolean),
    securityProtocol: raw.KAFKA_SECURITY_PROTOCOL,
    saslMechanism: raw.KAFKA_SASL_MECHANISM,
    saslUsername: raw.KAFKA_SASL_USERNAME,
    saslPassword: raw.KAFKA_SASL_PASSWORD,
    outboxTopic: raw.KAFKA_TOPIC_OUTBOX,
    consumerGroup: raw.KAFKA_CONSUMER_GROUP,
    clientId: raw.KAFKA_CLIENT_ID,
    saslEnabled:
      raw.KAFKA_SECURITY_PROTOCOL === 'SASL_SSL' ||
      raw.KAFKA_SECURITY_PROTOCOL === 'SASL_PLAINTEXT',
  }),

  // SMTP
  smtp: Object.freeze({
    host: raw.SMTP_HOST,
    port: raw.SMTP_PORT,
    user: raw.SMTP_USER,
    password: raw.SMTP_PASSWORD,
    secure: raw.SMTP_SECURE,
    from: raw.SMTP_FROM,
    fromName: raw.SMTP_FROM_NAME,
    enabled: raw.SMTP_HOST !== '', // ← disabled mode: log only
  }),

  // Email
  email: Object.freeze({
    maxRetries: raw.EMAIL_MAX_RETRIES,
    retryBaseMs: raw.EMAIL_RETRY_BASE_MS,
    rateLimitPerHour: raw.EMAIL_RATE_LIMIT_PER_HOUR,
  }),

  // In-app
  inApp: Object.freeze({
    retentionDays: raw.IN_APP_RETENTION_DAYS,
  }),

  // Auth service
  authServiceUrl: raw.AUTH_SERVICE_URL,
    // Feed service
  feedServiceUrl: raw.FEED_SERVICE_URL,

  // Frontend
  frontendUrl: raw.FRONTEND_URL,

  // Observability
  observability: Object.freeze({
    otlpEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT,
    otlpProtocol: raw.OTEL_EXPORTER_OTLP_PROTOCOL,
    otlpHeaders: raw.OTEL_EXPORTER_OTLP_HEADERS,
    sentryDsn: raw.SENTRY_DSN,
  }),
});

export type AppConfig = typeof config;