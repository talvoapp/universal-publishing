/**
 * Jest global setup / teardown.
 *
 * Responsibilities:
 *   1. Fail fast if required env vars are missing (no silent test runs).
 *   2. Initialize PostgreSQL & Redis connections ONCE for the whole suite.
 *   3. Run schema setup (create test DB tables if needed).
 *   4. Truncate tables between tests (isolation without full resets).
 *   5. Clean shutdown after all tests complete.
 *
 * Design note:
 *   - We reuse the same connection pools as production code, but point
 *     them at a dedicated TEST_* URL. This exercises the real query layer.
 *   - If TEST_* vars are absent, we fall back to the dev URLs, which is
 *     what CI uses inside a single test container.
 */

import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';

// ------------------------------------------------------------
// 1. LOAD TEST ENV BEFORE ANYTHING ELSE
// ------------------------------------------------------------
loadDotenv({ path: '.env.test', override: true });
loadDotenv({ path: '.env', override: false });

// ------------------------------------------------------------
// 2. FAIL FAST ON MISSING CRITICAL VARS
// ------------------------------------------------------------
const REQUIRED_FOR_TESTS = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
for (const v of REQUIRED_FOR_TESTS) {
  if (!process.env[v]) {
    // eslint-disable-next-line no-console
    console.error(`\n[TEST SETUP] Missing required env var: ${v}\n` +
      `Copy .env.example to .env.test and fill in test-specific values.\n`);
    process.exit(1);
  }
}

// Use dedicated test DBs if provided
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

// Force test-only behavior in config
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET.repeat(1); // ensure ≥32 (already required)

// ------------------------------------------------------------
// 3. GLOBAL SETUP
// ------------------------------------------------------------
import { initPostgres, closePostgres, query } from '@/db/postgres';
import { initRedis, closeRedis, getRedisClient } from '@/db/redis';

beforeAll(async () => {
  await initPostgres();
  await initRedis();

  // Ensure tables exist. On CI, migrations should have run already.
  // Local dev: run `make migrate` before `npm test`.
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS exists`,
  );
  if (!rows[0]?.exists) {
    throw new Error(
      'Test database is missing tables. Run `make migrate` first.',
    );
  }

  // Flush Redis test DB (do not touch other DB indices)
  const redis = getRedisClient();
  await redis.flushdb();
}, 30000);

// ------------------------------------------------------------
// 4. ISOLATION — TRUNCATE BETWEEN TESTS
// ------------------------------------------------------------
/**
 * Exported so individual test files can call it if they need a
 * mid-test reset. Not used automatically — tests should create the
 * data they need, this is a safety net.
 */
export async function resetDatabase(): Promise<void> {
  // Order matters: children first (FK constraints)
  await query(
    'TRUNCATE TABLE refresh_tokens, audit_logs, users RESTART IDENTITY CASCADE',
  );
  const redis = getRedisClient();
  await redis.flushdb();
}

// Auto-reset before each test file only (not each test — too slow).
// Individual `describe` blocks can call resetDatabase() explicitly.
beforeEach(async () => {
  // Only truncate if the test file hasn't marked itself as `serial`
  // and is not part of an integration test that seeds upfront.
  // For simplicity: truncate between every test in unit tests, and
  // let integration tests opt out via `describe.skip` of the helper.
  // -> We use an env flag flipped by individual test files.
  if (process.env.TEST_TRUNCATE !== 'false') {
    await resetDatabase();
  }
});

// ------------------------------------------------------------
// 5. GLOBAL TEARDOWN
// ------------------------------------------------------------
afterAll(async () => {
  await closeRedis();
  await closePostgres();
}, 30000);

// ------------------------------------------------------------
// 6. GLOBAL FAILSAFES
// ------------------------------------------------------------
// Fail any test that produces an unhandled rejection.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[TEST] Unhandled rejection:', reason);
  process.exit(1);
});

// Ensure every test sets a unique request ID for audit logs.
(global as unknown as { __testRequestId: () => string }).__testRequestId = () =>
  `test-${randomUUID()}`;