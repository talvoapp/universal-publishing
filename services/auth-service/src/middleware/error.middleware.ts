/**
 * Global error handling.
 *
 * Two middlewares:
 *   - `notFoundHandler` — 404 with RFC 7807 body
 *   - `errorHandler`    — the terminal handler; MUST be registered last
 *
 * The error handler:
 *   1. Normalizes every error into an `AppError` (with statusCode, code, details).
 *   2. Logs server errors (5xx) with full context; logs 4xx at `debug`.
 *   3. Sends a JSON response that never leaks stack traces in production.
 *   4. Sends errors to Sentry for 5xx only.
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  ValidationError,
  NotFoundError,
  type FieldError,
} from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import { captureException } from '@/utils/sentry';
import { config } from '@/config';

const log = createLogger('error-handler');

// ============================================================
// 404 HANDLER
// ============================================================
export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(
    new NotFoundError(
      `Route ${req.method} ${req.path} not found`,
    ),
  );
}

// ============================================================
// ERROR NORMALIZER
// ============================================================
interface NormalizedError {
  status: number;
  type: string;
  title: string;
  detail: string;
  code: string;
  errors?: FieldError[];
}

function normalize(err: unknown): NormalizedError {
  // ----- Our AppError subclasses -----
  if (err instanceof AppError) {
    return {
      status: err.statusCode,
      type: `https://httpstatuses.io/${err.statusCode}`,
      title: err.name.replace(/Error$/, ''),
      detail: err.message,
      code: err.code,
      ...(err instanceof ValidationError ? { errors: err.errors } : {}),
    };
  }

  // ----- Zod (defense in depth; normally caught by validation middleware) -----
  if (err instanceof ZodError) {
    const errors: FieldError[] = err.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
      code: i.code,
    }));
    return {
      status: 400,
      type: 'https://httpstatuses.io/400',
      title: 'Bad Request',
      detail: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      errors,
    };
  }

  // ----- Body-parser errors -----
  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type: string }).type === 'entity.too.large'
  ) {
    return {
      status: 413,
      type: 'https://httpstatuses.io/413',
      title: 'Payload Too Large',
      detail: 'Request body exceeds the allowed size',
      code: 'PAYLOAD_TOO_LARGE',
    };
  }

  if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    (err as { type: string }).type === 'entity.parse.failed'
  ) {
    return {
      status: 400,
      type: 'https://httpstatuses.io/400',
      title: 'Bad Request',
      detail: 'Malformed JSON in request body',
      code: 'MALFORMED_JSON',
    };
  }

  // ----- Fallback (unknown errors are 500) -----
  const message =
    err instanceof Error ? err.message : 'Internal server error';
  return {
    status: 500,
    type: 'https://httpstatuses.io/500',
    title: 'Internal Server Error',
    detail: config.isProd ? 'Something went wrong' : message,
    code: 'INTERNAL_ERROR',
  };
}

// ============================================================
// TERMINAL ERROR HANDLER
// ============================================================
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If headers were already sent, delegate to Express's default handler.
  if (res.headersSent) return next(err);

  const n = normalize(err);

  // ----- Logging -----
  const baseLog = {
    requestId: req.id,
    method: req.method,
    path: req.path,
    status: n.status,
    code: n.code,
    userId: req.user?.id,
  };

  if (n.status >= 500) {
    log.error({ ...baseLog, err }, 'Server error');
    captureException(err, {
      requestId: req.id,
      userId: req.user?.id,
      path: req.path,
    });
  } else if (n.status >= 400 && n.status !== 404) {
    log.debug({ ...baseLog, err: err instanceof Error ? err.message : err }, 'Client error');
  }

  // ----- Response -----
  const body: Record<string, unknown> = {
    type: n.type,
    title: n.title,
    status: n.status,
    detail: n.detail,
    code: n.code,
    instance: req.id,
    timestamp: new Date().toISOString(),
  };

  if (n.errors && n.errors.length > 0) {
    body.errors = n.errors;
  }

  // In development, expose stack trace for easier debugging.
  if (config.isDev && err instanceof Error && err.stack) {
    body.stack = err.stack.split('\n').slice(0, 10);
  }

  res.status(n.status).json(body);
}