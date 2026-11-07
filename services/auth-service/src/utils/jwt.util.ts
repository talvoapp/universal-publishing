/**
 * JWT signing & verification.
 *
 * Two token types are issued by the auth service:
 *
 *   - Access token  (short-lived, 15 min)
 *       Sent in `Authorization: Bearer …` on every API call.
 *       Contains: sub, email, role, emailVerified, type='access'.
 *       NOT stored server-side (stateless).
 *
 *   - Refresh token (long-lived, 7 days)
 *       Stored hashed in `refresh_tokens` for rotation/reuse detection.
 *       Contains: sub, type='refresh', familyId, jti.
 *
 * Both tokens are signed with HS256 by default; the secret length is
 * enforced at config load (≥32 chars), which is sufficient for HMAC.
 *
 * If the platform later migrates to RS256, only this file changes.
 */

import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '@/config';
import type { AuthRole } from '@/middleware/auth.middleware';

// ============================================================
// PAYLOAD TYPES
// ============================================================
export interface AccessTokenPayload extends JwtPayload {
  sub: string;
  email: string;
  role: AuthRole;
  emailVerified: boolean;
  type: 'access';
  jti: string;
}

export interface RefreshTokenPayload extends JwtPayload {
  sub: string;
  type: 'refresh';
  familyId: string;
  jti: string;
}

// ============================================================
// SIGN
// ============================================================
export function signAccessToken(input: {
  sub: string;
  email: string;
  role: AuthRole;
  emailVerified: boolean;
}): string {
  const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
    sub: input.sub,
    email: input.email,
    role: input.role,
    emailVerified: input.emailVerified,
    type: 'access',
    jti: randomUUID(),
  };

  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: config.jwt.accessExpiry,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  };

  return jwt.sign(payload, config.jwt.secret, options);
}

export function signRefreshToken(input: {
  sub: string;
  type: 'refresh';
  familyId: string;
  jti: string;
}): string {
  const payload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
    sub: input.sub,
    type: input.type,
    familyId: input.familyId,
    jti: input.jti,
  };

  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: config.jwt.refreshExpiry,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  };

  return jwt.sign(payload, config.jwt.refreshSecret, options);
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

  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, config.jwt.refreshSecret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  }) as RefreshTokenPayload;

  if (decoded.type !== 'refresh') {
    throw new Error('Token is not a refresh token');
  }

  return decoded;
}

// ============================================================
// DECODE WITHOUT VERIFY (for logging, diagnostics)
// ============================================================
export function decodeUnsafe(token: string): JwtPayload | null {
  const decoded = jwt.decode(token);
  return typeof decoded === 'object' && decoded !== null ? decoded : null;
}