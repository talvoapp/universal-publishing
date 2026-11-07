/**
 * Quota service — daily token budget per user.
 *
 * Storage: Redis counter `ai:quota:{userId}:{YYYY-MM-DD}` with TTL
 * of `config.quotas.windowHours` (default 24h). The key rotates at
 * UTC midnight because the date segment changes.
 *
 * Flow:
 *   - `checkAndReserveQuota()` — atomic check + INCRBY (returns new used)
 *   * `recordActualUsage()`    — adjust the reservation to match real
 *                                 usage reported by the provider
 *
 * "Reserve then adjust" is a standard pattern that ensures:
 *   - Concurrent requests cannot overspend (INCRBY is atomic).
 *   - Actual token counts (which providers report only at the end)
 *     are reflected correctly.
 */

import { getRedisClient, quotaKey } from '@/db/redis';
import { config } from '@/config';
import { QuotaExceededError, InternalServerError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import type { AuthRole } from '@/utils/jwt.util';
import type { QuotaStatus } from '@/types/index';

const log = createLogger('quota.service');

// ============================================================
// TIER RESOLUTION
// ============================================================
type Tier = 'free' | 'premium' | 'admin';

function tierForRole(role: AuthRole): Tier {
  if (role === 'admin') return 'admin';
  if (role === 'author' || role === 'editor') return 'premium';
  return 'free';
}

function limitForTier(tier: Tier): number {
  return config.quotas.tiers[tier];
}

// ============================================================
// DATE HELPERS
// ============================================================
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nextResetAt(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

// ============================================================
// CHECK + RESERVE
// ============================================================
export interface ReserveInput {
  userId: string;
  role: AuthRole;
  estimatedTokens: number;
}

export interface ReserveResult {
  tier: Tier;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  reserved: number;
}

export async function checkAndReserveQuota(
  input: ReserveInput,
): Promise<ReserveResult> {
  const tier = tierForRole(input.role);
  const limit = limitForTier(tier);
  const ymd = todayYmd();
  const redis = getRedisClient();
  const key = quotaKey(input.userId, ymd);
  const ttlSeconds = config.quotas.windowHours * 3600;

  // Reserve upfront (over-estimate is safe).
  let newUsed: number;
  try {
    newUsed = await redis.incrby(key, input.estimatedTokens);
    if (newUsed === input.estimatedTokens) {
      // First increment for this key — set TTL.
      await redis.expire(key, ttlSeconds);
    }
  } catch (err) {
    log.error({ err, userId: input.userId }, 'Quota check failed');
    throw new InternalServerError('Could not check quota', 'QUOTA_CHECK_FAILED');
  }

  if (newUsed > limit) {
    // Roll back the reservation — the request will fail.
    await redis.decrby(key, input.estimatedTokens).catch(() => undefined);
    log.warn(
      { userId: input.userId, newUsed, limit, tier },
      'Quota exceeded',
    );
    throw new QuotaExceededError({
      limit,
      used: newUsed - input.estimatedTokens,
      resetAt: nextResetAt(),
    });
  }

  return {
    tier,
    limit,
    used: newUsed,
    remaining: limit - newUsed,
    resetAt: nextResetAt(),
    reserved: input.estimatedTokens,
  };
}

// ============================================================
// RECORD ACTUAL USAGE
// ============================================================
/**
 * Adjust the reservation to match the actual tokens reported by the
 * provider. Called AFTER the stream completes.
 *
 * `delta` = actual - reserved
 *   - If positive → increment further (we under-reserved)
 *   - If negative → decrement (we over-reserved)
 */
export async function recordActualUsage(input: {
  userId: string;
  reserved: number;
  actual: number;
}): Promise<void> {
  const delta = input.actual - input.reserved;
  if (delta === 0) return;

  const ymd = todayYmd();
  const redis = getRedisClient();
  const key = quotaKey(input.userId, ymd);

  try {
    if (delta > 0) {
      await redis.incrby(key, delta);
    } else {
      // Don't let the counter go below 0.
      const current = await redis.get(key);
      const currentN = current ? parseInt(current, 10) : 0;
      const newValue = Math.max(0, currentN + delta);
      await redis.set(key, String(newValue), 'KEEPTTL');
    }
  } catch (err) {
    // Non-fatal — reservation was already applied; drift is acceptable.
    log.warn(
      { err, userId: input.userId, delta },
      'Failed to record actual token usage',
    );
  }
}

// ============================================================
// STATUS
// ============================================================
export async function getQuotaStatus(input: {
  userId: string;
  role: AuthRole;
}): Promise<QuotaStatus> {
  const tier = tierForRole(input.role);
  const limit = limitForTier(tier);
  const ymd = todayYmd();
  const redis = getRedisClient();
  const key = quotaKey(input.userId, ymd);

  let used = 0;
  try {
    const raw = await redis.get(key);
    used = raw ? parseInt(raw, 10) : 0;
  } catch (err) {
    log.warn({ err, userId: input.userId }, 'Failed to read quota');
  }

  const remaining = Math.max(0, limit - used);
  const warningPct = config.quotas.warningThresholdPct;
  const atWarning = limit > 0 && used / limit >= warningPct / 100;

  return {
    tier,
    limit,
    used,
    remaining,
    reset_at: nextResetAt(),
    warning_threshold_pct: warningPct,
    at_warning: atWarning,
  };
}