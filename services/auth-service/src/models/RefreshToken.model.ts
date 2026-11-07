/**
 * Refresh token model — with rotation, reuse detection, and family revocation.
 *
 * Schema (see 002_auth.sql):
 *   refresh_tokens (
 *     token_hash     TEXT PRIMARY KEY,
 *     user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *     family_id      UUID NOT NULL,
 *     expires_at     TIMESTAMPTZ NOT NULL,
 *     created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     created_by_ip  INET,
 *     created_by_user_agent TEXT,
 *     revoked_at     TIMESTAMPTZ,
 *     revoked_reason TEXT,
 *     replaced_by_ip INET,
 *     replaced_by_user_agent TEXT
 *   )
 */

import type { PoolClient } from 'pg';
import { query } from '@/db/postgres';

// ============================================================
// RECORD TYPE
// ============================================================
export interface RefreshTokenRecord {
  token_hash: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  created_at: Date;
  created_by_ip: string | null;
  created_by_user_agent: string | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  replaced_by_ip: string | null;
  replaced_by_user_agent: string | null;
}

const SELECT_COLS = `
  token_hash, user_id, family_id, expires_at, created_at,
  created_by_ip, created_by_user_agent,
  revoked_at, revoked_reason,
  replaced_by_ip, replaced_by_user_agent
`;

// ============================================================
// CREATE
// ============================================================
export async function create(input: {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  createdByIp: string;
  createdByUserAgent: string;
}): Promise<void> {
  await query(
    `INSERT INTO refresh_tokens (
       token_hash, user_id, family_id, expires_at,
       created_by_ip, created_by_user_agent
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.tokenHash,
      input.userId,
      input.familyId,
      input.expiresAt,
      input.createdByIp,
      input.createdByUserAgent,
    ],
  );
}

// ============================================================
// READ
// ============================================================
export async function findByHash(
  tokenHash: string,
): Promise<RefreshTokenRecord | null> {
  const { rows } = await query<RefreshTokenRecord>(
    `SELECT ${SELECT_COLS} FROM refresh_tokens WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// ============================================================
// ROTATE
// ============================================================
/**
 * Atomically revoke the old token and insert the new one, both in one
 * transaction. `family_id` is preserved so reuse detection works.
 *
 * We use a single statement pair guarded by a WHERE clause that
 * requires the old token to still be unrevoked; if another process
 * already rotated it, we abort.
 */
export async function rotate(input: {
  oldHash: string;
  newHash: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  replacedByIp: string;
  replacedByUserAgent: string;
}): Promise<void> {
  // Use a CTE: revoke (only if not already revoked) + insert, atomically.
  const { rowCount } = await query(
    `WITH revoked AS (
       UPDATE refresh_tokens
          SET revoked_at = now(),
              revoked_reason = 'rotated',
              replaced_by_ip = $5,
              replaced_by_user_agent = $6
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING token_hash
     )
     INSERT INTO refresh_tokens (
       token_hash, user_id, family_id, expires_at,
       created_by_ip, created_by_user_agent
     )
     SELECT $2, $3, $4, $7, $5, $6
     FROM revoked`,
    [
      input.oldHash,
      input.newHash,
      input.userId,
      input.familyId,
      input.replacedByIp,
      input.replacedByUserAgent,
      input.expiresAt,
    ],
  );

  if (!rowCount || rowCount === 0) {
    // The old token was already revoked by a concurrent request.
    throw new Error('REFRESH_ROTATION_CONFLICT');
  }
}

// ============================================================
// REVOKE
// ============================================================
export async function revoke(
  tokenHash: string,
  reason: string,
): Promise<void> {
  await query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash, reason],
  );
}

export async function revokeFamily(familyId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = 'reuse_detected'
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

export async function revokeAllForUser(
  userId: string,
  reason: string,
): Promise<void> {
  await query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

// ============================================================
// REVOKE — inside an existing transaction
// ============================================================
export async function revokeAllForUserWithClient(
  client: PoolClient,
  userId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}