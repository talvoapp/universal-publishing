/**
 * Generic Zod validators for body / query / params.
 * Identical contract to auth-service: on failure → 400 RFC 7807
 * with per-field errors; on success → parsed value replaces req[source].
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '@/utils/errors';

// ============================================================
// ERROR FORMATTING
// ============================================================
interface FieldError {
  path: string;
  message: string;
  code: string;
}

function toFieldErrors(err: ZodError): FieldError[] {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

// ============================================================
// FACTORY
// ============================================================
type Source = 'body' | 'query' | 'params';

function validate(source: Source) {
  return (schema: ZodSchema) =>
    (req: Request, _res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        const errors = toFieldErrors(result.error);
        throw new ValidationError(`Invalid request ${source}`, errors);
      }
      if (source === 'params') {
        Object.assign(req.params, result.data);
      } else {
        req[source] = result.data;
      }
      next();
    };
}

export const validateBody = validate('body');
export const validateQuery = validate('query');
export const validateParams = validate('params');