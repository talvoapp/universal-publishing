/**
 * Authentication middleware for editor-service.
 *
 * This service CONSUMES tokens issued by auth-service. We only
 * verify, never sign. Payload shape is identical to auth-service.
 *
 * Two entry points:
 *   - `requireAuth`  — 401 if invalid/missing token
 *   - `optionalAuth` — attach req.user if valid, else continue
 *
 * Both populate `req.user` with a typed principal matching the
 * auth-service `AuthenticatedUser` shape (id, email, role, emailVerified).
 */

import type { Request, Response, NextFunction } from 'express';
import {
  verifyAccessToken,
  type AccessTokenPayload,
  type AuthRole,
} from '@/utils/jwt.util';
import { setSentryUser } from '@/utils/sentry';
import { UnauthorizedError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';

const log = createLogger('auth.middleware');

// ============================================================
// TYPES
// ============================================================
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: AuthRole;
  emailVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      jwtPayload?: AccessTokenPayload;
      id: string;
    }
  }
}

// ============================================================
// EXTRACTION
// ============================================================
function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  if (token.length > 4096) return null;
  return token;
}

// ============================================================
// MIDDLEWARE
// ============================================================
export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearer(req);
  if (!token) {
    throw new UnauthorizedError('Missing Authorization header');
  }

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    log.debug({ err }, 'Invalid access token');
    throw new UnauthorizedError('Invalid or expired access token');
  }

  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    emailVerified: payload.emailVerified,
  };
  req.jwtPayload = payload;
  setSentryUser(payload.sub, payload.role);

  next();
}

export function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearer(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    if (payload.type === 'access') {
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        emailVerified: payload.emailVerified,
      };
      req.jwtPayload = payload;
      setSentryUser(payload.sub, payload.role);
    }
  } catch {
    // silently ignore
  }
  next();
}

/**
 * Returns the current user or throws 401. Used by controllers to
 * satisfy TypeScript's non-null narrowing after `requireAuth`.
 */
export function getCurrentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  return req.user;
}