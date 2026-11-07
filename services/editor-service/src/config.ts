/**
 * Centralized configuration for editor-service.
 *
 * In addition to the usual auth-service-style vars, this service has
 * editor-specific tunables:
 *   - WebSocket tuning (ping intervals, max payload size)
 *   - Patch coalescing window (server-side debounce)
 *   - Snapshot frequency (every N versions)
 *   - Presence TTL (how long before an idle peer is considered gone)
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

const portNumber = intString(1, 65535, 4002);

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

  // -------- MongoDB --------
  MONGO_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('mongodb://') || u.startsWith('mongodb+srv://'),
      'must be a mongodb:// or mongodb+srv:// URL',
    ),
  MONGO_DB_NAME: z.string().default('upp_editor'),
  MONGO_MAX_POOL: intString(1, 200, 20),
  MONGO_SERVER_SELECTION_TIMEOUT_MS: intString(1000, 60000, 5000),

  // -------- Redis --------
  REDIS_URL: z.string().url(),
  REDIS_KEY_PREFIX: z.string().default('editor:'),

  // -------- JWT --------
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('upp-auth'),
  JWT_AUDIENCE: z.string().default('upp-platform'),

  // -------- Kafka (outbox events) --------
  KAFKA_BROKERS: z.string().default('kafka:9092'),
  KAFKA_TOPIC_OUTBOX: z.string().default('upp.outbox.events'),
  KAFKA_CLIENT_ID: z.string().default('editor-service'),

  // -------- CORS --------
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001')
    .transform((v) =>
      v.split(',').map((s) => s.trim()).filter(Boolean),
    ),

  // -------- Rate limiting (HTTP) --------
  RATE_LIMIT_WINDOW_MS: intString(1000, 3_600_000, 60_000),
  RATE_LIMIT_MAX_REQUESTS: intString(1, 10_000, 100),

  // -------- WebSocket tuning --------
  WS_PATH: z.string().default('/editor/stream'),
  WS_MAX_PAYLOAD_BYTES: intString(1024, 10 * 1024 * 1024, 512 * 1024), // 512 KB default
  WS_PING_INTERVAL_MS: intString(5000, 120_000, 30_000),
  WS_PONG_TIMEOUT_MS: intString(5000, 120_000, 10_000),
  WS_MAX_CONNECTIONS_PER_USER: intString(1, 100, 10),
  WS_MAX_MESSAGE_RATE_PER_SEC: intString(1, 500, 60),

  // -------- Editor semantics --------
  // Server-side debounce window for coalescing adjacent patch ops.
  // The client also debounces (300-500ms), but we coalesce on the
  // server too to protect MongoDB from write amplification.
  EDITOR_PATCH_COALESCE_MS: intString(50, 5000, 200),

  // A snapshot (full document) is taken every N ops per draft. This
  // bounds the cost of reconstructing a draft from its op log.
  EDITOR_SNAPSHOT_EVERY_N_OPS: intString(10, 1000, 50),

  // Presence TTL: how long a peer is considered active without a
  // keep-alive message. Mirrors WS_PING_INTERVAL_MS by default.
  EDITOR_PRESENCE_TTL_MS: intString(5000, 300_000, 60_000),

  // Maximum draft size in characters. Larger drafts cause UX lag
  // and inflate memory. Enforce at the API and WebSocket layers.
  EDITOR_MAX_DRAFT_CHARS: intString(10_000, 50_000_000, 5_000_000), // 5M chars ≈ 5 MB

  // -------- Observability --------
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  SERVICE_NAME: z.string().default('editor-service'),
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

  // ----- Mongo -----
  mongo: Object.freeze({
    url: raw.MONGO_URL,
    dbName: raw.MONGO_DB_NAME,
    maxPool: raw.MONGO_MAX_POOL,
    serverSelectionTimeoutMs: raw.MONGO_SERVER_SELECTION_TIMEOUT_MS,
  }),

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

  // ----- Kafka -----
  kafka: Object.freeze({
    brokers: raw.KAFKA_BROKERS.split(',').map((s) => s.trim()),
    outboxTopic: raw.KAFKA_TOPIC_OUTBOX,
    clientId: raw.KAFKA_CLIENT_ID,
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

  // ----- WebSocket -----
  ws: Object.freeze({
    path: raw.WS_PATH,
    maxPayloadBytes: raw.WS_MAX_PAYLOAD_BYTES,
    pingIntervalMs: raw.WS_PING_INTERVAL_MS,
    pongTimeoutMs: raw.WS_PONG_TIMEOUT_MS,
    maxConnectionsPerUser: raw.WS_MAX_CONNECTIONS_PER_USER,
    maxMessageRatePerSec: raw.WS_MAX_MESSAGE_RATE_PER_SEC,
  }),

  // ----- Editor semantics -----
  editor: Object.freeze({
    patchCoalesceMs: raw.EDITOR_PATCH_COALESCE_MS,
    snapshotEveryNOps: raw.EDITOR_SNAPSHOT_EVERY_N_OPS,
    presenceTtlMs: raw.EDITOR_PRESENCE_TTL_MS,
    maxDraftChars: raw.EDITOR_MAX_DRAFT_CHARS,
  }),

  // ----- Observability -----
  observability: Object.freeze({
    otlpEndpoint: raw.OTEL_EXPORTER_OTLP_ENDPOINT,
    sentryDsn: raw.SENTRY_DSN,
  }),
});

export type AppConfig = typeof config;