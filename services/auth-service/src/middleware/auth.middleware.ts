/**
 * Authentication middleware.
 *
 * Two entry points:
 *   - `requireAuth`  — hard requirement; 401 if invalid/missing token
 *   - `optionalAuth` — attaches req.user if a valid token is present; otherwise continues
 *
 * Both populate `req.user` with a minimal, typed principal:
 *   { id, email, role, emailVerified }
 *
 * The raw JWT payload is also exposed as `req.jwtPayload` for endpoints
 * that need `jti` (token revocation) or `iat`/`exp` info.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type AccessTokenPayload } from '@/utils/jwt.util';
import { setSentryUser } from '@/utils/sentry';
import { UnauthorizedError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';

const log = createLogger('auth.middleware');

// ============================================================
// TYPES
// ============================================================
export type AuthRole = 'reader' | 'author' | 'editor' | 'admin';

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
  if (token.length > 4096) return null; // sanity bound
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

  if (payload.type !== 'access') {
    throw new UnauthorizedError('Token type mismatch');
  }

  const user: AuthenticatedUser = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    emailVerified: payload.emailVerified,
  };

  req.user = user;
  req.jwtPayload = payload;

  // Attach to Sentry so any downstream error is correlated to the user.
  setSentryUser(user.id, user.role);

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
    // Silently ignore invalid tokens on optional-auth routes.
  }
  next();
}

/**
 * Returns the current user or throws 401. Use inside controllers
 * after `requireAuth` to satisfy TypeScript's non-null narrowing.
 */
export function getCurrentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  return req.user;
}