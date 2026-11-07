/**
 * Sentry integration for editor-service.
 *
 * Behavior identical to auth-service: no-op without DSN, PII scrubbing
 * before send, 10% trace sampling in production.
 *
 * Extra: scrubs WebSocket-specific PII (draft content, ops, presence).
 */

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { config } from '@/config';

let initialized = false;

// ============================================================
// INIT
// ============================================================
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
      profilesSampleRate: config.isProd ? 0.1 : 1.0,
      integrations: [nodeProfilingIntegration()],
      beforeSend(event) {
        return scrubPII(event);
      },
      ignoreErrors: [
        'ValidationError',
        'UnauthorizedError',
        'ForbiddenError',
        'NotFoundError',
        'ECONNRESET',
        'ETIMEDOUT',
        // WS lifecycle noise — not actionable incidents
        'WebSocket is not open',
        'Invalid WebSocket frame',
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

// ============================================================
// CAPTURE
// ============================================================
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized || !config.observability.sentryDsn) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        // Drop keys that likely contain draft content
        if (['content', 'ops', 'patch', 'text'].includes(k)) continue;
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
        if (['content', 'ops', 'patch', 'text'].includes(k)) continue;
        scope.setExtra(k, v);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

export function setSentryUser(userId: string, role: string): void {
  if (!initialized || !config.observability.sentryDsn) return;
  Sentry.setUser({ id: userId, username: `user:${role}` });
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized || !config.observability.sentryDsn) return;
  await Sentry.close(timeoutMs);
}

// ============================================================
// PII SCRUBBING
// ============================================================
const PII_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'email',
  'phone',
  'ssn',
  'taxId',
  'cardNumber',
  'cvv',
  'iban',
  // Editor-specific — never leak draft content into Sentry
  'content',
  'draft',
  'ops',
  'patch',
  'text',
]);

function scrubPII(event: Sentry.Event): Sentry.Event | null {
  if (event.request?.data) {
    event.request.data = scrub(event.request.data) as typeof event.request.data;
  }
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    for (const k of Object.keys(headers)) {
      if (PII_KEYS.has(k.toLowerCase())) headers[k] = '[REDACTED]';
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
    if (PII_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]';
    else out[k] = scrub(v, depth + 1);
  }
  return out;
}