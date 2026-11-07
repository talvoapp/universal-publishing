/**
 * Authentication middleware for ai-service.
 * Consumer only — verify, never sign.
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

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  if (token.length > 4096) return null;
  return token;
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = extractBearer(req);
  if (!token) throw new UnauthorizedError('Missing Authorization header');

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

export function getCurrentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthorizedError('Not authenticated');
  return req.user;
}