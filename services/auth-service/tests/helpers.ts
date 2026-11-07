/**
 * Test helpers — reusable building blocks.
 *
 * Philosophy:
 *   - Each helper creates minimal state and returns typed values.
 *   - Never mutate global state (except through documented reset helpers).
 *   - All helpers are async and use the real DB (not mocks) so
 *     integration tests stay realistic.
 */

import { randomUUID } from 'crypto';
import { query } from '@/db/postgres';
import { hashPassword } from '@/utils/password.util';
import { signAccessToken, signRefreshToken } from '@/utils/jwt.util';
import type { AuthRole } from '@/middleware/auth.middleware';

// ============================================================
// USER FACTORY
// ============================================================
export interface TestUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
  role: AuthRole;
  emailVerified: boolean;
  accessToken: string;
  refreshToken: string;
}

export interface CreateTestUserOptions {
  email?: string;
  password?: string;
  displayName?: string;
  role?: AuthRole;
  emailVerified?: boolean;
  withTokens?: boolean;
}

/**
 * Creates a real user in the DB, and (optionally) issues real JWTs.
 * Uses random emails so tests can run in parallel without collisions.
 */
export async function createTestUser(
  opts: CreateTestUserOptions = {},
): Promise<TestUser> {
  const email = opts.email ?? `test-${randomUUID()}@example.com`;
  const password = opts.password ?? 'TestPass123';
  const displayName = opts.displayName ?? 'Test User';
  const role = opts.role ?? 'reader';
  const emailVerified = opts.emailVerified ?? true;

  const passwordHash = await hashPassword(password);

  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, role, email_verified)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [email.toLowerCase(), passwordHash, displayName, role, emailVerified],
  );
  const id = rows[0]!.id;

  let accessToken = '';
  let refreshToken = '';
  if (opts.withTokens !== false) {
    accessToken = signAccessToken({
      sub: id,
      email,
      role,
      emailVerified,
    });
    refreshToken = signRefreshToken({
      sub: id,
      type: 'refresh',
      familyId: randomUUID(),
      jti: randomUUID(),
    });
  }

  return {
    id,
    email,
    password,
    displayName,
    role,
    emailVerified,
    accessToken,
    refreshToken,
  };
}

// ============================================================
// REQUEST FACTORY (for supertest)
// ============================================================
export function authHeader(user: { accessToken: string }): {
  Authorization: string;
} {
  return { Authorization: `Bearer ${user.accessToken}` };
}

// ============================================================
// DATABASE ASSERTIONS
// ============================================================
export async function countUsers(email?: string): Promise<number> {
  const { rows } = email
    ? await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users WHERE email = $1`,
        [email.toLowerCase()],
      )
    : await query<{ count: string }>(`SELECT count(*)::text AS count FROM users`);
  return parseInt(rows[0]?.count ?? '0', 10);
}

export async function countRefreshTokens(userId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

export async function countAuditLogs(
  userId: string,
  action?: string,
): Promise<number> {
  const { rows } = action
    ? await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs
         WHERE user_id = $1 AND action = $2`,
        [userId, action],
      )
    : await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_logs WHERE user_id = $1`,
        [userId],
      );
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ============================================================
// TIME MANIPULATION (for expiry tests)
// ============================================================
/**
 * Expires all refresh tokens for a user immediately, so tests can
 * exercise the "expired token" code path without waiting.
 */
export async function expireRefreshTokensFor(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET expires_at = now() - interval '1 second'
     WHERE user_id = $1`,
    [userId],
  );
}

/**
 * Marks a refresh token as revoked (simulates previous rotation).
 * Used to test reuse detection.
 */
export async function revokeRefreshTokenManually(
  tokenHash: string,
  reason = 'manual_test',
): Promise<void> {
  await query(
    `UPDATE refresh_tokens
       SET revoked_at = now(), revoked_reason = $2
     WHERE token_hash = $1`,
    [tokenHash, reason],
  );
}

// ============================================================
// SHA-256 (mirrors the service's hashing)
// ============================================================
import { createHash } from 'crypto';
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}