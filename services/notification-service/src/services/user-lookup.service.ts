/**
 * User lookup service — fetches user email from auth-service.
 *
 * Notification handlers can't query `users` directly because the users
 * table lives in `auth_db` (different Postgres database). Instead, we
 * call auth-service's `/api/v1/users/:id` endpoint.
 *
 * Caching: 5-minute in-memory cache to avoid hammering auth-service
 * during follower notifications (batch of 1000).
 */

import { createLogger } from '@/utils/logger';
import { config } from '@/config';
import { TransientError } from '@/utils/errors';

const log = createLogger('user-lookup');

interface CacheEntry {
  email: string;
  displayName: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface UserInfo {
  email: string;
  displayName: string;
}

/**
 * Fetches user info from auth-service. Returns null if user not found.
 * Throws TransientError on network failure (so Kafka retries).
 */
export async function lookupUser(userId: string): Promise<UserInfo | null> {
  // Cache hit
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return { email: cached.email, displayName: cached.displayName };
  }

  const url = `${config.authServiceUrl}/api/v1/users/${encodeURIComponent(userId)}/public`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 404) {
      log.debug({ userId }, 'user_not_found');
      return null;
    }

    if (!res.ok) {
      log.warn({ userId, status: res.status }, 'auth_service_error');
      throw new TransientError(
        `auth-service returned ${res.status}`,
        'AUTH_LOOKUP_FAILED',
      );
    }

    const data = (await res.json()) as {
      email?: string;
      displayName?: string;
      display_name?: string;
    };

    const info: UserInfo = {
      email: data.email ?? '',
      displayName: data.displayName ?? data.display_name ?? 'User',
    };

    // Cache
    cache.set(userId, { ...info, expiresAt: Date.now() + CACHE_TTL_MS });

    return info;
  } catch (err) {
    if (err instanceof TransientError) throw err;
    log.error({ err, userId, url }, 'auth_service_unreachable');
    throw new TransientError(
      `Failed to lookup user ${userId}: ${(err as Error).message}`,
      'AUTH_UNREACHABLE',
    );
  }
}

export function _clearUserCacheForTests(): void {
  cache.clear();
}