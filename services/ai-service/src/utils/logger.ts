/**
 * Structured logger for ai-service.
 *
 * Editor-specific serializers:
 *   - `aiReq`: request metadata (operation, model, userId, sessionId)
 *     NEVER the prompt content — that's user data.
 *   - `aiRes`: response metadata (tokens_in, tokens_out, model, duration)
 *     NEVER the generated text.
 *
 * Redaction covers: prompt, response, content, text, messages, delta,
 * plus auth/PII keys shared with other services.
 */

import pino, { type Logger, type LoggerOptions } from 'pino';
import { config } from '@/config';

// ============================================================
// REDACTION
// ============================================================
const REDACT_PATHS: string[] = [
  // Auth secrets
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
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',

  // Nested
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',

  // AI-specific: NEVER log user input or model output
  'prompt',
  'response',
  'content',
  'text',
  'messages',
  'delta',
  'completion',
  'selection',
  'instruction',
  '*.prompt',
  '*.response',
  '*.content',
  '*.text',
  '*.messages',
  '*.delta',
  '*.completion',
  '*.selection',
  '*.instruction',

  // PII
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
    // AI request metadata — safe fields only
    aiReq: (r: {
      userId?: string;
      operation?: string;
      provider?: string;
      model?: string;
      sessionId?: string;
      tokensIn?: number;
    }) => ({
      userId: r.userId,
      operation: r.operation,
      provider: r.provider,
      model: r.model,
      sessionId: r.sessionId,
      tokensIn: r.tokensIn,
    }),
    // AI response metadata — safe fields only
    aiRes: (r: {
      provider?: string;
      model?: string;
      tokensIn?: number;
      tokensOut?: number;
      durationMs?: number;
      finishReason?: string;
      error?: string;
    }) => ({
      provider: r.provider,
      model: r.model,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      durationMs: r.durationMs,
      finishReason: r.finishReason,
      error: r.error,
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