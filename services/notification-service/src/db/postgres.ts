/**
 * PostgreSQL connection pool + helpers.
 *
 * Responsibilities:
 *   - `notifications` table (in-app inbox, also used for dedup)
 *   - `processed_events` table (idempotency barrier for Kafka)
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('postgres');

let pool: Pool | null = null;

// ============================================================
// INIT / CLOSE / HEALTH
// ============================================================
export async function initPostgres(): Promise<void> {
  if (pool) return;

  pool = new Pool({
    connectionString: config.database.url,
    min: config.database.poolMin,
    max: config.database.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    application_name: 'upp-notification-service',
  });

  pool.on('error', (err) => {
    log.error({ err }, 'Idle PostgreSQL client error');
  });

  const { rows } = await pool.query<{ now: Date }>('SELECT now() AS now');
  log.info(
    { poolMin: config.database.poolMin, poolMax: config.database.poolMax, dbTime: rows[0]?.now?.toISOString() },
    'PostgreSQL pool initialized',
  );
}

export async function closePostgres(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  try {
    await p.end();
    log.info('PostgreSQL pool closed');
  } catch (err) {
    log.error({ err }, 'Error closing PostgreSQL pool');
  }
}

export async function checkPostgresHealth(): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// QUERY
// ============================================================
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  return pool.query<T>(text, params as never[]);
}

// ============================================================
// TRANSACTIONS
// ============================================================
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      log.error({ err: rbErr }, 'Rollback failed');
    }
    throw err;
  } finally {
    client.release();
  }
}