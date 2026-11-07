/**
 * Generic Zod validators for body / query / params.
 */

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '@/utils/errors';

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

type Source = 'body' | 'query' | 'params';

function validate(source: Source) {
  return (schema: ZodSchema) =>
    (req: Request, _res: Response, next: NextFunction): void => {
      const result = schema.safeParse(req[source]);
      if (!result.success) {
        throw new ValidationError(`Invalid request ${source}`, toFieldErrors(result.error));
      }
      if (source === 'params') Object.assign(req.params, result.data);
      else req[source] = result.data;
      next();
    };
}

export const validateBody = validate('body');
export const validateQuery = validate('query');
export const validateParams = validate('params');