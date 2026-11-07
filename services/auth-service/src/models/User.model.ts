/**
 * User model — data access only.
 *
 * Every query is parameterized. `_WithClient` variants accept an
 * existing transaction client so multi-table writes stay atomic.
 */

import type { PoolClient } from 'pg';
import { query } from '@/db/postgres';
import type { AuthRole } from '@/middleware/auth.middleware';

// ============================================================
// RECORD TYPE
// ============================================================
export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  language: string;
  role: AuthRole;
  email_verified: boolean;
  verification_token_hash: string | null;
  verification_token_expires_at: Date | null;
  password_reset_token_hash: string | null;
  password_reset_expires_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `
  id, email, password_hash, display_name, bio, avatar_url, language,
  role, email_verified,
  verification_token_hash, verification_token_expires_at,
  password_reset_token_hash, password_reset_expires_at,
  deleted_at, created_at, updated_at
`;

// ============================================================
// READ
// ============================================================
export async function findById(id: string): Promise<UserRecord | null> {
  const { rows } = await query<UserRecord>(
    `SELECT ${SELECT_COLS} FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await query<UserRecord>(
    `SELECT ${SELECT_COLS} FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findByVerificationToken(
  tokenHash: string,
): Promise<UserRecord | null> {
  const { rows } = await query<UserRecord>(
    `SELECT ${SELECT_COLS} FROM users
     WHERE verification_token_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function findByPasswordResetToken(
  tokenHash: string,
): Promise<UserRecord | null> {
  const { rows } = await query<UserRecord>(
    `SELECT ${SELECT_COLS} FROM users
     WHERE password_reset_token_hash = $1 AND deleted_at IS NULL LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

// ============================================================
// CREATE
// ============================================================
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
  role?: AuthRole;
  emailVerified?: boolean;
  avatarUrl?: string | null;
  verificationTokenHash?: string | null;
  verificationTokenExpiresAt?: Date | null;
}

export async function create(
  client: PoolClient,
  input: CreateUserInput,
): Promise<UserRecord> {
  const { rows } = await client.query<UserRecord>(
    `INSERT INTO users (
       email, password_hash, display_name, role, email_verified,
       avatar_url, verification_token_hash, verification_token_expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SELECT_COLS}`,
    [
      input.email.toLowerCase(),
      input.passwordHash,
      input.displayName,
      input.role ?? 'reader',
      input.emailVerified ?? false,
      input.avatarUrl ?? null,
      input.verificationTokenHash ?? null,
      input.verificationTokenExpiresAt ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('Insert returned no row');
  return row;
}

// ============================================================
// UPDATE — general
// ============================================================
export interface UpdateUserInput {
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  language?: string;
}

export async function update(
  id: string,
  input: UpdateUserInput,
): Promise<UserRecord> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    fields.push(`${k} = $${idx}`);
    values.push(v);
    idx++;
  }

  if (fields.length === 0) {
    const existing = await findById(id);
    if (!existing) throw new Error('User not found');
    return existing;
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await query<UserRecord>(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING ${SELECT_COLS}`,
    values,
  );
  const row = rows[0];
  if (!row) throw new Error('Update returned no row');
  return row;
}

// ============================================================
// UPDATE — email verification
// ============================================================
export async function setVerificationToken(
  userId: string,
  hash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `UPDATE users
        SET verification_token_hash = $1,
            verification_token_expires_at = $2,
            updated_at = now()
      WHERE id = $3`,
    [hash, expiresAt, userId],
  );
}

export async function markEmailVerifiedWithClient(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE users
        SET email_verified = true,
            verification_token_hash = NULL,
            verification_token_expires_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}

// ============================================================
// UPDATE — password reset
// ============================================================
export async function setPasswordResetToken(
  userId: string,
  hash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `UPDATE users
        SET password_reset_token_hash = $1,
            password_reset_expires_at = $2,
            updated_at = now()
      WHERE id = $3`,
    [hash, expiresAt, userId],
  );
}

export async function clearPasswordResetTokenWithClient(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE users
        SET password_reset_token_hash = NULL,
            password_reset_expires_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [userId],
  );
}

// ============================================================
// UPDATE — password
// ============================================================
export async function updatePasswordWithClient(
  client: PoolClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await client.query(
    `UPDATE users
        SET password_hash = $1,
            updated_at = now()
      WHERE id = $2`,
    [passwordHash, userId],
  );
}

// ============================================================
// UPDATE — soft delete
// ============================================================
export async function scheduleHardDeleteWithClient(
  client: PoolClient,
  userId: string,
): Promise<void> {
  await client.query(
    `UPDATE users
        SET deleted_at = now(),
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
}