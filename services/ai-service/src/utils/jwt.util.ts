/**
 * JWT utility for ai-service.
 *
 * Consumer only — verifies access tokens issued by auth-service.
 * Never signs. Same contract as editor-service.
 */

import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '@/config';

export type AuthRole = 'reader' | 'author' | 'editor' | 'admin';

export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: AuthRole;
  emailVerified: boolean;
  type: 'access';
  jti: string;
}

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

export function decodeUnsafe(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  return typeof decoded === 'object' && decoded !== null ? decoded : null;
}