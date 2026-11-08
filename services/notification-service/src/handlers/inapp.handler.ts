/**
 * In-app notification handler — inserts into `notifications` table.
 *
 * In-app notifications are shown in the user's inbox in the frontend.
 * They are also used as a fallback when email fails.
 *
 * IDEMPOTENCY DESIGN:
 *   We check idempotency BEFORE the insert (fast path), but only
 *   RESERVE the idempotency key AFTER a successful insert. This
 *   guarantees:
 *     - Duplicate event deliveries are deduped (fast check)
 *     - Failed inserts can be retried (no key was reserved)
 *
 *   The unique constraint on `notifications(idempotency_key)` provides
 *   the final safety net — even if two concurrent requests race past
 *   the Redis check, only one insert will succeed.
 */

import { query } from '@/db/postgres';
import { createLogger } from '@/utils/logger';
import { getRedisClient, key } from '@/db/redis';
import { config } from '@/config';

const log = createLogger('handler.inapp');

export interface CreateInAppInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function createInAppNotification(
  input: CreateInAppInput,
): Promise<void> {
  // ----- 1. Fast idempotency check (Redis) -----
  // We check but DO NOT reserve yet — reservation happens after the
  // successful insert (see step 3). This avoids the "reserved but
  // insert failed" bug.
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('inapp', 'idem', input.idempotencyKey);
      const exists = await redis.exists(idemKey);
      if (exists === 1) {
        log.debug(
          { idempotencyKey: input.idempotencyKey },
          'inapp_already_created_skip',
        );
        return;
      }
    } catch (err) {
      // Redis failure → fail open. Let the DB unique constraint
      // catch duplicates (defense in depth).
      log.warn({ err }, 'inapp_idempotency_check_failed_failing_open');
    }
  }

  // ----- 2. Insert (single statement — no transaction needed) -----
  try {
    await query(
      `INSERT INTO notifications (
        user_id, type, title, body, link_url, metadata, idempotency_key, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
      ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.userId,
        input.type,
        input.title,
        input.body,
        input.linkUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.idempotencyKey ?? null,
      ],
    );
  } catch (err) {
    log.error({ err, userId: input.userId }, 'inapp_insert_failed');
    throw err;
  }

  // ----- 3. Reserve the idempotency key (best-effort) -----
  // Only AFTER a successful insert. If this fails, the DB unique
  // constraint still protects us on retry.
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('inapp', 'idem', input.idempotencyKey);
      await redis.set(idemKey, '1', 'EX', 86400);
    } catch (err) {
      log.warn({ err }, 'inapp_idempotency_reserve_failed');
    }
  }

  log.info(
    {
      userId: input.userId,
      type: input.type,
      retentionDays: config.inApp.retentionDays,
    },
    'inapp_notification_created',
  );
}