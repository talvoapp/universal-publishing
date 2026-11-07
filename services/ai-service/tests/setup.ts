/**
 * Jest global setup for ai-service. (updated — includes encoder reset)
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.test', override: true });
loadDotenv({ path: '.env', override: false });

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.OPENAI_API_KEY = 'sk-test-not-real';
}

if (!process.env.REDIS_URL || !process.env.JWT_SECRET) {
  console.error(
    '\n[TEST] Missing required env: REDIS_URL, JWT_SECRET\n' +
      'Copy .env.example to .env.test and fill in test values.\n',
  );
  process.exit(1);
}

import { initRedis, closeRedis, getRedisClient } from '@/db/redis';
import { config } from '@/config';
import { _resetEncoderForTests } from '@/utils/token-counter';

beforeAll(async () => {
  await initRedis();
}, 30000);

beforeEach(async () => {
  const redis = getRedisClient();
  try {
    const keys = await redis.keys(`${config.redis.keyPrefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  } catch { /* ignore */ }
});

afterEach(() => {
  _resetEncoderForTests();
});

afterAll(async () => {
  await closeRedis();
}, 30000);

process.on('unhandledRejection', (reason) => {
  console.error('[TEST] Unhandled rejection:', reason);
  process.exit(1);
});