/**
 * Structured logger built on Pino.
 *
 * Goals:
 *   - JSON logs in production (ELK / Loki / CloudWatch ingestible)
 *   - Pretty-printed, colored logs in development
 *   - Zero secrets/PII in logs (redaction built in)
 *   - Child loggers per module (bind service name + component)
 *
 * Usage:
 *   const log = createLogger('auth.controller');
 *   log.info({ userId }, 'User logged in');
 *   log.error({ err, email }, 'Login failed');
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '@/config';

// ============================================================
// REDACTION PATHS — never log these fields
// ============================================================
/**
 * Pino redaction paths follow JSON pointer-like syntax.
 * We cover every field name that could contain secrets or PII
 * across all our request/response shapes.
 */
const REDACT_PATHS: string[] = [
  // ----- Auth secrets -----
  'password',
  'password_hash',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'apiKey',
  'api_key',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',

  // ----- Nested request/response shapes -----
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.password_hash',
  'body.newPassword',
  'body.currentPassword',
  'body.token',
  'body.refreshToken',
  'body.accessToken',
  '*.password',
  '*.password_hash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',

  // ----- PII (opt-in only; we usually log IDs) -----
  'email',
  'phone',
  'phoneNumber',
  'ssn',
  'taxId',
  'creditCard',
  'cardNumber',
  'cvv',
  'iban',
  'stripeCustomerId',
];

// ============================================================
// BASE OPTIONS (shared)
// ============================================================
const baseOptions: LoggerOptions = {
  level: config.logLevel,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  base: {
    service: config.serviceName,
    version: config.serviceVersion,
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: () => ({}), // already in `base`
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
};

// ============================================================
// DEVELOPMENT TRANSPORT (pretty, colored, readable)
// ============================================================
const devTransport = config.isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,service,version,env',
        singleLine: false,
        messageFormat: '{service} | {msg}',
      },
    }
  : undefined;

// ============================================================
// ROOT LOGGER
// ============================================================
export const rootLogger: Logger = pino({
  ...baseOptions,
  ...(devTransport ? { transport: devTransport } : {}),
});

// ============================================================
// CREATE CHILD LOGGER PER MODULE
// ============================================================
/**
 * Returns a child logger bound to the given component name.
 * Prefer this over the root logger everywhere — it makes
 * filtering logs by subsystem trivial.
 */
export function createLogger(component: string): Logger {
  return rootLogger.child({ component });
}

// ============================================================
// HTTP REQUEST LOGGER (for pino-http middleware)
// ============================================================
/**
 * Generates a fresh request logger that we plug into `pino-http`.
 * In development we use pretty output; in production, JSON.
 */
export function createHttpLogger() {
  // Lazy import to keep startup time low
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pinoHttp = require('pino-http') as typeof import('pino-http');
  return pinoHttp.default({
    logger: rootLogger,
    // Do not log health checks (they'd flood logs)
    autoLogging: {
      ignore: (req) =>
        req.url === '/health' ||
        req.url === '/ready' ||
        req.url === '/metrics' ||
        req.url?.startsWith('/health/') === true,
    },
    // Trim request body in logs (already redacted)
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
        userAgent: req.headers['user-agent'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} → ${res.statusCode}`,
    customErrorMessage: (req, res) =>
      `${req.method} ${req.url} → ${res.statusCode} (error)`,
  });
}