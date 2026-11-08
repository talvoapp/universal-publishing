/**
 * Structured logger for notification-service.
 *
 * Redaction is aggressive here because notifications contain:
 *   - Email content (bodies, subjects) — PII
 *   - Recipient emails
 *   - Template variables (may include order details, tax info)
 *
 * Only metadata (event type, recipient ID, provider, status) is logged.
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '@/config';

// ============================================================
// REDACTION PATHS
// ============================================================
const REDACT_PATHS: string[] = [
  // Auth secrets
  'password',
  'password_hash',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'apiKey',

  // PII
  'email',
  'recipientEmail',
  'phone',

  // Notification content — never log email bodies
  'subject',
  'body',
  'html',
  'text',
  'content',
  'template',
  'variables',
  'payload',
  'data',

  // Nested
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.email',
  '*.subject',
  '*.body',
  '*.html',
  '*.variables',
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
    // Notification metadata — safe fields only
    notification: (n: {
      id?: string;
      type?: string;
      recipientId?: string;
      channel?: string;
      template?: string;
      status?: string;
    }) => ({
      id: n.id,
      type: n.type,
      recipientId: n.recipientId,
      channel: n.channel,
      template: n.template,
      status: n.status,
    }),
    // Kafka event metadata — safe fields only
    event: (e: {
      id?: string;
      type?: string;
      aggregateId?: string;
    }) => ({
      id: e.id,
      type: e.type,
      aggregateId: e.aggregateId,
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
// HTTP LOGGER
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
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  });
}