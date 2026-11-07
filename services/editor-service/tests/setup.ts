/**
 * Jest global setup — connects Mongo & Redis, resets state between tests.
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.test', override: true });
loadDotenv({ path: '.env', override: false });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

if (!process.env.MONGO_URL || !process.env.REDIS_URL || !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error(
    '\n[TEST] Missing required env: MONGO_URL, REDIS_URL, JWT_SECRET\n' +
      'Copy .env.example to .env.test and fill in test values.\n',
  );
  process.exit(1);
}

import { initMongo, closeMongo } from '@/db/mongo';
import { initRedis, closeRedis, getRedisClient } from '@/db/redis';
import { DraftModel } from '@/models/Draft.model';
import { DraftOpModel } from '@/models/DraftOp.model';

beforeAll(async () => {
  await initMongo();
  await initRedis();
}, 30000);

beforeEach(async () => {
  // Truncate drafts + ops between tests (children first — no FK here
  // since we're in Mongo, but explicit order aids debuggability)
  await DraftOpModel.deleteMany({});
  await DraftModel.deleteMany({});
  try {
    await getRedisClient().flushdb();
  } catch {
    // ignore
  }
});

afterAll(async () => {
  await closeRedis();
  await closeMongo();
}, 30000);