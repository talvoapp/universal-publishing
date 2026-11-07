/**
 * Structured logger for editor-service.
 *
 * Same implementation as auth-service, plus editor-specific serializers:
 *   - `ws`: WebSocket connection metadata
 *   - `draft`: draft id + version (safe to log, no content)
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '@/config';

// ============================================================
// REDACTION PATHS
// ============================================================
const REDACT_PATHS: string[] = [
  // ----- Auth secrets -----
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'apiKey',

  // ----- Nested -----
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',

  // ----- Editor-specific: never log draft content -----
  'content',
  'draft.content',
  'ops',
  'patch',
  'text',
  'body.content',
  '*.content',
  '*.ops',
  '*.patch',

  // ----- PII -----
  'email',
  'phone',
];

// ============================================================
// BASE OPTIONS
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
    bindings: () => ({}),
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    // Editor-specific: log WS connections without leaking message content
    ws: (ws: { id?: string; userId?: string; draftId?: string; remoteAddress?: string }) => ({
      id: ws.id,
      userId: ws.userId,
      draftId: ws.draftId,
      remoteAddress: ws.remoteAddress,
    }),
    draft: (d: { id?: string; version?: number; opCount?: number }) => ({
      id: d.id,
      version: d.version,
      opCount: d.opCount,
    }),
  },
};

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
// CHILD LOGGER
// ============================================================
export function createLogger(component: string): Logger {
  return rootLogger.child({ component });
}

// ============================================================
// HTTP LOGGER (pino-http)
// ============================================================
export function createHttpLogger() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pinoHttp = require('pino-http') as typeof import('pino-http');
  return pinoHttp.default({
    logger: rootLogger,
    autoLogging: {
      ignore: (req) =>
        req.url === '/health' ||
        req.url === '/ready' ||
        req.url === '/metrics',
    },
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
        userAgent: req.headers['user-agent'],
      }),
      res: (res) => ({ statusCode: res.statusCode }),
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