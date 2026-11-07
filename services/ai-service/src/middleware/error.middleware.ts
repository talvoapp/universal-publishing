/**
 * Global error handling for ai-service (RFC 7807).
 */

import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  ValidationError,
  NotFoundError,
  QuotaExceededError,
  type FieldError,
} from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import { captureException } from '@/utils/sentry';
import { config } from '@/config';

const log = createLogger('error-handler');

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

interface NormalizedError {
  status: number;
  type: string;
  title: string;
  detail: string;
  code: string;
  errors?: FieldError[];
  extra?: Record<string, unknown>;
}

function normalize(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    const base: NormalizedError = {
      status: err.statusCode,
      type: `https://httpstatuses.io/${err.statusCode}`,
      title: err.name.replace(/Error$/, ''),
      detail: err.message,
      code: err.code,
      ...(err instanceof ValidationError ? { errors: err.errors } : {}),
    };
    if (err instanceof QuotaExceededError) {
      base.extra = {
        quota: {
          limit: err.limit,
          used: err.used,
          reset_at: err.resetAt,
        },
      };
    }
    return base;
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      type: 'https://httpstatuses.io/400',
      title: 'Bad Request',
      detail: 'Request validation failed',
      code: 'VALIDATION_ERROR',
      errors: err.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        message: i.message,
        code: i.code,
      })),
    };
  }

  if (
    err && typeof err === 'object' && 'type' in err &&
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
    err && typeof err === 'object' && 'type' in err &&
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

  const message = err instanceof Error ? err.message : 'Internal server error';
  return {
    status: 500,
    type: 'https://httpstatuses.io/500',
    title: 'Internal Server Error',
    detail: config.isProd ? 'Something went wrong' : message,
    code: 'INTERNAL_ERROR',
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) return next(err);

  const n = normalize(err);
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
    log.debug(
      { ...baseLog, err: err instanceof Error ? err.message : err },
      'Client error',
    );
  }

  const body: Record<string, unknown> = {
    type: n.type,
    title: n.title,
    status: n.status,
    detail: n.detail,
    code: n.code,
    instance: req.id,
    timestamp: new Date().toISOString(),
    ...(n.errors ? { errors: n.errors } : {}),
    ...(n.extra ?? {}),
  };

  if (config.isDev && err instanceof Error && err.stack) {
    body['stack'] = err.stack.split('\n').slice(0, 10);
  }

  res.status(n.status).json(body);
}