/**
 * Audit log model — append-only security event trail.
 *
 * Every authentication-relevant action (login, logout, password change,
 * OAuth registration, deletion, refresh-reuse detection, …) is recorded
 * here. Rows are never updated or deleted by the application; retention
 * is handled by a scheduled purge job (see docs/legal/privacy-policy.md).
 *
 * Columns (see 002_auth.sql):
 *   id, user_id (nullable), action, ip, request_id, metadata JSONB, created_at
 */

import type { PoolClient } from 'pg';
import { query } from '@/db/postgres';

// ============================================================
// TYPES
// ============================================================
/**
 * Canonical set of actions — keeps callers honest and log searches easy.
 */
export type AuditAction =
  | 'register_success'
  | 'register_conflict'
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'refresh_reuse_detected'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'password_changed'
  | 'password_change_failed'
  | 'email_verified'
  | 'verification_resent'
  | 'oauth_register:google'
  | 'oauth_register:github'
  | 'deletion_scheduled'
  | 'deletion_failed';

export interface AuditLogRecord {
  id: string;
  user_id: string | null;
  action: AuditAction;
  ip: string | null;
  request_id: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface RecordAuditInput {
  userId: string | null;
  action: AuditAction;
  ip: string | null;
  requestId: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// WRITE
// ============================================================
/**
 * Record a single audit event on the default pool.
 * Failures are swallowed and logged — audit logging must never
 * break the primary auth flow.
 */
export async function record(input: RecordAuditInput): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, ip, request_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.userId,
        input.action,
        input.ip,
        input.requestId,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (err) {
    // Lazy import to avoid a circular dependency at module-load time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createLogger } = require('@/utils/logger') as typeof import('@/utils/logger');
    createLogger('audit').error({ err, action: input.action }, 'Failed to write audit log');
  }
}

/**
 * Record an audit event inside an existing transaction.
 * Unlike `record()`, this one DOES throw on failure — the caller
 * is inside a transaction and expects atomicity.
 */
export async function recordWithClient(
  client: PoolClient,
  input: RecordAuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (user_id, action, ip, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.userId,
      input.action,
      input.ip,
      input.requestId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

// ============================================================
// READ (admin / compliance)
// ============================================================
export async function findByUser(
  userId: string,
  limit = 100,
): Promise<AuditLogRecord[]> {
  const { rows } = await query<AuditLogRecord>(
    `SELECT id, user_id, action, ip, request_id, metadata, created_at
       FROM audit_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 1000)],
  );
  return rows;
}

export async function findByAction(
  action: AuditAction,
  limit = 100,
): Promise<AuditLogRecord[]> {
  const { rows } = await query<AuditLogRecord>(
    `SELECT id, user_id, action, ip, request_id, metadata, created_at
       FROM audit_logs
      WHERE action = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [action, Math.min(Math.max(limit, 1), 1000)],
  );
  return rows;
}