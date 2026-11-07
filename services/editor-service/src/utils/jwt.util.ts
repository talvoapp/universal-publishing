/**
 * JWT utility for editor-service.
 *
 * Editor-service is a CONSUMER of access tokens issued by auth-service —
 * it NEVER signs tokens itself. This file only:
 *   - Verifies access tokens (used by HTTP middleware + WebSocket auth frame)
 *   - Exposes the typed payload shape (shared with auth-service)
 *
 * Design notes:
 *   - We MUST verify with the same secret, issuer, and audience as
 *     auth-service. If any of these diverge, all requests get 401.
 *   - We deliberately do not implement refresh-token verification here;
 *     refreshing is the auth-service's job.
 */

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '@/config';

// ============================================================
// TYPES
// ============================================================
export type AuthRole = 'reader' | 'author' | 'editor' | 'admin';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: AuthRole;
  emailVerified: boolean;
  type: 'access';
  jti: string;
}

// ============================================================
// VERIFY
// ============================================================
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  }) as AccessTokenPayload;

  if (decoded.type !== 'access') {
    throw new Error('Token is not an access token');
  }

  if (typeof decoded.sub !== 'string' || !decoded.sub) {
    throw new Error('Token missing sub');
  }

  return decoded;
}

// ============================================================
// DECODE (diagnostics only — never trust for auth decisions)
// ============================================================
export function decodeUnsafe(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  return typeof decoded === 'object' && decoded !== null ? decoded : null;
}