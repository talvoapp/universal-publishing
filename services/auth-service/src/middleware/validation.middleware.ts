/**
 * Generic Zod validators for request body / query / params.
 *
 * Usage:
 *   router.post('/x', validateBody(schema), handler);
 *   router.get('/y',  validateQuery(querySchema), handler);
 *   router.get('/z/:id', validateParams(paramsSchema), handler);
 *
 * On failure → 400 with an RFC 7807 body containing per-field errors.
 * On success → the parsed (and coerced) value REPLACES `req.body`
 * (or query/params) so downstream code sees typed, sanitized data.
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
// GENERIC FACTORY
// ============================================================
type Source = 'body' | 'query' | 'params';

function validate(source: Source) {
  return (schema: ZodSchema) =>
    (req: Request, _res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[source]);

      if (!result.success) {
        const errors = toFieldErrors(result.error);
        throw new ValidationError(
          `Invalid request ${source}`,
          errors,
        );
      }

      // Overwrite with the parsed value (coerced, stripped unknown keys if
      // the schema uses `.strict()` or `.strip()` — Zod's default is strip).
      // `params` is read-only in some Express versions, so assign via cast.
      if (source === 'params') {
        Object.assign(req.params, result.data);
      } else {
        req[source] = result.data;
      }

      next();
    };
}

// ============================================================
// PUBLIC EXPORTS
// ============================================================
export const validateBody = validate('body');
export const validateQuery = validate('query');
export const validateParams = validate('params');