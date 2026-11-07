/**
 * Test helpers for ai-service.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '@/config';

// ============================================================
// TOKENS
// ============================================================
export interface TestUser {
  id: string;
  email: string;
  role: 'reader' | 'author' | 'editor' | 'admin';
  emailVerified: boolean;
  accessToken: string;
}

export function createTestUser(opts: {
  role?: TestUser['role'];
  emailVerified?: boolean;
} = {}): TestUser {
  const id = randomUUID();
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const role = opts.role ?? 'reader';
  const emailVerified = opts.emailVerified ?? true;

  const accessToken = jwt.sign(
    {
      sub: id,
      email,
      role,
      emailVerified,
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

  return { id, email, role, emailVerified, accessToken };
}

// ============================================================
// SSE PARSING
// ============================================================
export interface SSEFrame {
  event: string;
  data: string;
}

/**
 * Parses a raw SSE body into an array of frames.
 * Useful when testing endpoints that return a complete SSE body
 * (i.e., after `res.end()` completes).
 */
export function parseSSE(rawBody: string): SSEFrame[] {
  const frames: SSEFrame[] = [];
  const blocks = rawBody.split('\n\n').filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
      else if (line.startsWith(':')) continue; // comment/keepalive
    }
    if (data.length > 0) frames.push({ event, data });
  }
  return frames;
}

/**
 * Extracts frames of a specific event type.
 */
export function framesOfType(frames: SSEFrame[], type: string): unknown[] {
  return frames
    .filter((f) => f.event === type)
    .map((f) => {
      try {
        return JSON.parse(f.data);
      } catch {
        return f.data;
      }
    });
}

/**
 * Concatenates all `chunk` deltas into a single string.
 */
export function concatenateChunks(frames: SSEFrame[]): string {
  let out = '';
  for (const f of frames) {
    if (f.event === 'chunk') {
      try {
        const parsed = JSON.parse(f.data) as { delta?: string };
        if (parsed.delta) out += parsed.delta;
      } catch {
        // ignore
      }
    }
  }
  return out;
}