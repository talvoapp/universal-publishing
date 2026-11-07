/**
 * Sentry integration — error tracking & performance.
 *
 * Behavior:
 *   - If SENTRY_DSN is missing → all exports become no-ops.
 *     This keeps the service functional in local dev / CI
 *     without a Sentry account.
 *   - In production → initializes Sentry with:
 *       * traces sample rate 10%
 *       * profiles sample rate 10%
 *       * PII stripped before send (defense-in-depth on top of logger redaction)
 *
 * Usage:
 *   import { initSentry, captureException } from '@/utils/sentry';
 *   initSentry();                       // call once at startup
 *   captureException(err, { userId });  // anywhere in code
 */

import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { config } from '@/config';

// ============================================================
// STATE
// ============================================================
let initialized = false;

// ============================================================
// INIT
// ============================================================
/**
 * Initialize Sentry exactly once. Safe to call multiple times.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = config.observability.sentryDsn;
  if (!dsn) {
    // No DSN configured: silently skip. Common in local dev.
    return;
  }

  try {
    Sentry.init({
      dsn,
      environment: config.env,
      release: `${config.serviceName}@${config.serviceVersion}`,
      serverName: config.serviceName,

      // Trace 10% of transactions (adjust per traffic volume)
      tracesSampleRate: config.isProd ? 0.1 : 1.0,
      profilesSampleRate: config.isProd ? 0.1 : 1.0,

      integrations: [nodeProfilingIntegration()],

      // Only send errors whose level is `error` or worse
      beforeSend(event) {
        return scrubPII(event);
      },

      // Ignore expected/benign errors
      ignoreErrors: [
        // 4xx errors handled by our error middleware are not "incidents"
        'ValidationError',
        'UnauthorizedError',
        'ForbiddenError',
        'NotFoundError',
        // DB connection resets during deploys
        'ECONNRESET',
        'ETIMEDOUT',
      ],

      // Do not attach local variables (may contain secrets)
      attachStacktrace: true,
      sendDefaultPii: false,
      normalizeDepth: 5,
      maxBreadcrumbs: 50,
    });
  } catch (err) {
    // Never let Sentry init bring down the service.
    // eslint-disable-next-line no-console
    console.error('[sentry] Initialization failed (service continues):', err);
  }
}

// ============================================================
// CAPTURE HELPERS
// ============================================================
/**
 * Capture an exception with optional extra context.
 * No-op if Sentry is not initialized.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized || !config.observability.sentryDsn) return;

  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
    } else {
      Sentry.captureMessage(String(error), 'error');
    }
  });
}

/**
 * Capture a message at a given severity.
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>,
): void {
  if (!initialized || !config.observability.sentryDsn) return;

  Sentry.withScope((scope) => {
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

/**
 * Attach the current user (by ID only) to the active Sentry scope.
 * Call this in auth middleware after JWT validation.
 */
export function setSentryUser(userId: string, role: string): void {
  if (!initialized || !config.observability.sentryDsn) return;
  Sentry.setUser({ id: userId, username: `user:${role}` });
}

/**
 * Flush pending events (call during graceful shutdown).
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized || !config.observability.sentryDsn) return;
  await Sentry.close(timeoutMs);
}

// ============================================================
// PII SCRUBBING (defense in depth)
// ============================================================
const PII_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'email',
  'phone',
  'ssn',
  'taxId',
  'cardNumber',
  'cvv',
  'iban',
]);

function scrubPII(event: Sentry.Event): Sentry.Event | null {
  // Scrub request body
  if (event.request?.data) {
    event.request.data = scrub(event.request.data) as typeof event.request.data;
  }

  // Scrub headers
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    for (const k of Object.keys(headers)) {
      if (PII_KEYS.has(k.toLowerCase())) headers[k] = '[REDACTED]';
    }
  }

  // Scrub breadcrumbs
  if (event.breadcrumbs) {
    for (const bc of event.breadcrumbs) {
      if (bc.data) {
        bc.data = scrub(bc.data) as typeof bc.data;
      }
    }
  }

  return event;
}

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((v) => scrub(v, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out;
}