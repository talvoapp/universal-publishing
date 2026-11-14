/**
 * Jest global setup / teardown.
 */

// ------------------------------------------------------------
// 1. ALL IMPORTS AT TOP
// ------------------------------------------------------------
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'crypto';

// ------------------------------------------------------------
// 2. LOAD TEST ENV (BEFORE any other module reads process.env)
// ------------------------------------------------------------
loadDotenv({ path: '.env.test', override: true });
loadDotenv({ path: '.env', override: false });

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = process.env['TEST_LOG_LEVEL'] ?? 'silent';

process.env['DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'];
process.env['REDIS_URL'] =
  process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'];

// ------------------------------------------------------------
// 3. FAIL FAST ON MISSING CRITICAL VARS
// ------------------------------------------------------------
const REQUIRED_FOR_TESTS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

for (const v of REQUIRED_FOR_TESTS) {
  if (!process.env[v]) {
    console.error(
      `\n[TEST SETUP] Missing required env var: ${v}\n` +
        `Copy .env.example to .env.test and fill in test-specific values.\n`,
    );
    process.exit(1);
  }
}

// ------------------------------------------------------------
// 4. SAFETY — refuse to run against non-test DBs
// ------------------------------------------------------------
const dbUrl = process.env['DATABASE_URL'] ?? '';
const looksLikeTest =
  dbUrl.includes('_test') ||
  dbUrl.includes('/test') ||
  dbUrl.includes('-test') ||
  process.env['TEST_ALLOW_NON_TEST_DB'] === 'true';

if (!looksLikeTest) {
  console.error(
    `\n[TEST SETUP] Refusing to run: DATABASE_URL does not look like a test database.\n` +
      `             Expected URL to contain "_test" or "/test" or "-test".\n` +
      `             To override (NOT recommended), set TEST_ALLOW_NON_TEST_DB=true.\n`,
  );
  process.exit(1);
}

// ------------------------------------------------------------
// 5. JWT SECRET LENGTH SANITY
// ------------------------------------------------------------
if ((process.env['JWT_SECRET'] ?? '').length < 32) {
  console.error('[TEST SETUP] JWT_SECRET must be at least 32 chars.');
  process.exit(1);
}
if ((process.env['JWT_REFRESH_SECRET'] ?? '').length < 32) {
  console.error('[TEST SETUP] JWT_REFRESH_SECRET must be at least 32 chars.');
  process.exit(1);
}

// ------------------------------------------------------------
// 6. IMPORTS THAT DEPEND ON process.env
// ------------------------------------------------------------
import { initPostgres, closePostgres, query } from '@/db/postgres';
import { initRedis, closeRedis, getRedisClient } from '@/db/redis';

// ------------------------------------------------------------
// 7. GLOBAL SETUP
// ------------------------------------------------------------
beforeAll(async () => {
  await initPostgres();
  await initRedis();

  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS exists`,
  );

  if (!rows[0]?.exists) {
    throw new Error(
      'Test database is missing schema. Run `npm run migrate` first.',
    );
  }

  const redis = getRedisClient();
  await redis.flushdb();
}, 60_000);

// ------------------------------------------------------------
// 8. ISOLATION — truncate once per FILE
// ------------------------------------------------------------
export async function resetDatabase(): Promise<void> {
  await query(
    'TRUNCATE TABLE refresh_tokens, audit_logs, users RESTART IDENTITY CASCADE',
  );
  const redis = getRedisClient();
  await redis.flushdb();
}

beforeEach(async () => {
  if (process.env['TEST_TRUNCATE'] === 'false') return;

  const g = globalThis as Record<string, unknown>;
  if (!g['__testFileTruncated']) {
    await resetDatabase();
    g['__testFileTruncated'] = true;
  }
});

// ------------------------------------------------------------
// 9. GLOBAL TEARDOWN
// ------------------------------------------------------------
afterAll(async () => {
  await closeRedis();
  await closePostgres();
}, 30_000);

// ------------------------------------------------------------
// 10. GLOBAL FAILSAFES
// ------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  console.error('[TEST] Unhandled rejection:', reason);
  process.exit(1);
});

// ------------------------------------------------------------
// 11. TEST HELPERS
// ------------------------------------------------------------
(globalThis as Record<string, unknown>)['__testRequestId'] = (): string =>
  `test-${randomUUID()}`;