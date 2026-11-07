/**
 * Token helper for tests — signs valid access tokens with the test
 * config's JWT secret so that the WebSocket auth frame and HTTP
 * middleware both accept them.
 *
 * WARNING: uses `sign` here (unlike the production jwt.util which only
 * verifies). Test-only helper.
 */

import jwt from 'jsonwebtoken';
import { config } from '@/config';

export interface SignInput {
  sub: string;
  email: string;
  role: 'reader' | 'author' | 'editor' | 'admin';
  emailVerified: boolean;
}

export function signAccessToken(input: SignInput): string {
  return jwt.sign(
    {
      sub: input.sub,
      email: input.email,
      role: input.role,
      emailVerified: input.emailVerified,
      type: 'access',
      jti: `test-${Date.now()}`,
    },
    config.jwt.secret,
    {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    },
  );
}