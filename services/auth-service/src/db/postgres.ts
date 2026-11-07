/**
 * PostgreSQL connection pool + transaction helpers.
 *
 * Exports:
 *   - `initPostgres()`        — create the pool, run a sanity query
 *   - `closePostgres()`       — graceful pool end
 *   - `checkPostgresHealth()` — SELECT 1 with a short timeout
 *   - `query()`               — simple query wrapper (retries on transient errors)
 *   - `withTransaction()`     — runs a callback inside BEGIN/COMMIT
 *
 * Design notes:
 *   - Pool size, timeouts, and SSL are driven by `config`.
 *   - Any error thrown inside `withTransaction` triggers ROLLBACK.
 *   - We retry only on connection-level errors (ECONNRESET, ETIMEDOUT),
 *     never on SQL errors — the latter must bubble up.
 *   - The pool is a module singleton; safe to import anywhere.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('postgres');

// ============================================================
// STATE
// ============================================================
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
    statement_timeout: config.database.statementTimeoutMs,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(config.database.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    application_name: 'upp-auth-service',
  });

  // Surface pool-level errors — if we ignore them, the process may
  // accumulate idle clients that fail silently.
  pool.on('error', (err) => {
    log.error({ err }, 'Idle PostgreSQL client error');
  });

  // Sanity check — fail startup if the DB is unreachable.
  const { rows } = await pool.query<{ now: Date }>('SELECT now() AS now');
  log.info(
    {
      poolMin: config.database.poolMin,
      poolMax: config.database.poolMax,
      dbTime: rows[0]?.now?.toISOString(),
    },
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
    await pool.query({ text: 'SELECT 1', query_timeout: 2_000 } as never);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// QUERY
// ============================================================
/**
 * Run a parameterized query. Retries transient connection errors
 * (ECONNRESET, ETIMEDOUT, ENOTFOUND) up to 2 extra times.
 *
 * Never retries SQL errors — those are the caller's problem.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  if (!pool) throw new Error('PostgreSQL pool not initialized');
  return runWithRetry(() => pool!.query<T>(text, params as never[]));
}

async function runWithRetry<T>(op: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string }).code;
      const retriable =
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        code === '57P01'; // admin_shutdown
      if (!retriable || i === attempts - 1) throw err;
      const backoff = 50 * (i + 1);
      log.warn({ code, attempt: i + 1, backoffMs: backoff }, 'Retrying query');
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// TRANSACTIONS
// ============================================================
/**
 * Run `fn` inside a BEGIN…COMMIT block.
 *
 * - On success → COMMIT, returns `fn`'s result.
 * - On throw   → ROLLBACK, re-throws original error.
 * - Client is always released back to the pool.
 */
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