/**
 * Push notification handler — sends via FCM (stubbed in v1).
 *
 * Flow:
 *   1. Check idempotency (Redis EXISTS — no reservation yet)
 *   2. Look up user's device tokens (in Postgres — v2)
 *   3. Send via FCM (v1: log only)
 *   4. On success: reserve the idempotency key in Redis
 *
 * In v1, we log and consider it successful (no FCM credentials).
 * The interface is stable so v2 only needs to fill the send body.
 */

import { createLogger } from '@/utils/logger';
import { getRedisClient, key } from '@/db/redis';
import { config } from '@/config';
import type { SendPushInput } from '@/types/index';

const log = createLogger('handler.push');

// ============================================================
// PUBLIC
// ============================================================
export async function sendPush(input: SendPushInput): Promise<void> {
  // ----- 1. Idempotency check (fast path, no reservation) -----
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('push', 'idem', input.idempotencyKey);
      const exists = await redis.exists(idemKey);
      if (exists === 1) {
        log.debug(
          { idempotencyKey: input.idempotencyKey },
          'push_already_sent_skip',
        );
        return;
      }
    } catch (err) {
      log.warn({ err }, 'push_idempotency_check_failed_failing_open');
    }
  }

  // ----- 2. v1: stub (log only) -----
  // v2: look up device tokens from `device_tokens` table
  //     call FCM admin SDK
  try {
    log.info(
      {
        userId: input.userId,
        title: input.title,
        bodyLength: input.body.length,
        dataKeys: input.data ? Object.keys(input.data) : [],
        env: config.env,
      },
      'push_stub_logged',
    );

    // TODO(v2): replace with actual FCM call
  } catch (err) {
    // v2: classify as TransientError or PermanentError
    log.error({ err, userId: input.userId }, 'push_send_failed');
    throw err;
  }

  // ----- 3. Reserve idempotency key (only after success) -----
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('push', 'idem', input.idempotencyKey);
      await redis.set(idemKey, '1', 'EX', 86400);
    } catch (err) {
      log.warn({ err }, 'push_idempotency_reserve_failed');
    }
  }
}