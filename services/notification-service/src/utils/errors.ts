/**
 * Custom error classes for notification-service.
 */

export interface FieldError {
  path: string;
  message: string;
  code: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

export class ValidationError extends AppError {
  public readonly errors: FieldError[];
  constructor(message = 'Validation failed', errors: FieldError[] = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(message, 500, code);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service unavailable', code = 'SERVICE_UNAVAILABLE') {
    super(message, 503, code);
  }
}

// ============================================================
// NOTIFICATION-SPECIFIC
// ============================================================

/**
 * TransientError — retryable (SMTP timeout, network glitch, rate limit).
 * The consumer will requeue the message.
 */
export class TransientError extends AppError {
  constructor(message = 'Transient error', code = 'TRANSIENT_ERROR') {
    super(message, 503, code);
  }
}

/**
 * PermanentError — non-retryable (invalid email format, bounced, template
 * missing). The consumer will mark processed and NOT retry.
 */
export class PermanentError extends AppError {
  constructor(message = 'Permanent error', code = 'PERMANENT_ERROR') {
    super(message, 400, code);
  }
}