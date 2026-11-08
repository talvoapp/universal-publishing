/**
 * Sentry integration — no-op without DSN, aggressive PII scrubbing.
 */

import * as Sentry from '@sentry/node';
import { config } from '@/config';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = config.observability.sentryDsn;
  if (!dsn) return;

  try {
    Sentry.init({
      dsn,
      environment: config.env,
      release: `${config.serviceName}@${config.serviceVersion}`,
      serverName: config.serviceName,
      tracesSampleRate: config.isProd ? 0.1 : 1.0,
      beforeSend(event) {
        return scrubPII(event);
      },
      ignoreErrors: [
        // Expected SMTP errors — logged, not incidents
        'EAUTH',
        'ECONNREFUSED',
        'ETIMEDOUT',
        // Kafka disconnects
        'KafkaJSConnectionError',
        // Notification-specific
        'RECIPIENT_BOUNCED',
        'INVALID_EMAIL',
      ],
      attachStacktrace: true,
      sendDefaultPii: false,
      normalizeDepth: 5,
      maxBreadcrumbs: 50,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sentry] Initialization failed (service continues):', err);
  }
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized || !config.observability.sentryDsn) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (SCRUB_KEYS.has(k.toLowerCase())) continue;
        scope.setExtra(k, v);
      }
    }
    if (error instanceof Error) Sentry.captureException(error);
    else Sentry.captureMessage(String(error), 'error');
  });
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>,
): void {
  if (!initialized || !config.observability.sentryDsn) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        if (SCRUB_KEYS.has(k.toLowerCase())) continue;
        scope.setExtra(k, v);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized || !config.observability.sentryDsn) return;
  await Sentry.close(timeoutMs);
}

// ============================================================
// SCRUBBING
// ============================================================
const SCRUB_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'authorization',
  'cookie',
  'email',
  'recipientEmail',
  'subject',
  'body',
  'html',
  'text',
  'content',
  'template',
  'variables',
  'payload',
]);

function scrubPII(event: Sentry.Event): Sentry.Event | null {
  if (event.request?.data) {
    event.request.data = scrub(event.request.data) as typeof event.request.data;
  }
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    for (const k of Object.keys(headers)) {
      if (SCRUB_KEYS.has(k.toLowerCase())) headers[k] = '[REDACTED]';
    }
  }
  if (event.breadcrumbs) {
    for (const bc of event.breadcrumbs) {
      if (bc.data) bc.data = scrub(bc.data) as typeof bc.data;
    }
  }
  return event;
}

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SCRUB_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]';
    else out[k] = scrub(v, depth + 1);
  }
  return out;
}