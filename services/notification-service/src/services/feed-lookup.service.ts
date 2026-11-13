/**
 * Feed lookup service — fetches follower IDs from feed-service.
 *
 * The `follows` table lives in `feed_db` (a separate Postgres database
 * owned by feed-service). This service calls feed-service's HTTP API
 * instead of querying the DB directly.
 *
 * Caching: 2-minute in-memory cache to absorb bursty publish events
 * (an author publishing 5 drafts in 1 minute → 1 lookup, 5 reuses).
 */

import { createLogger } from '@/utils/logger';
import { config } from '@/config';
import { TransientError } from '@/utils/errors';

const log = createLogger('feed-lookup');

interface CacheEntry {
  followerIds: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetches follower IDs for a given user from feed-service.
 *
 * Returns an array of user IDs (may be empty).
 * Throws TransientError on network failure (so Kafka retries).
 *
 * @param userId   — the followee (author) ID
 * @param limit    — max number of followers to return
 */
export async function fetchFollowers(
  userId: string,
  limit: number = 1000,
): Promise<string[]> {
  const cacheKey = `${userId}:${limit}`;

  // Cache hit
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.followerIds;
  }

  const url =
    `${config.feedServiceUrl}/api/v1/follows/${encodeURIComponent(userId)}/followers` +
    `?limit=${limit}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 404) {
      log.debug({ userId }, 'user_has_no_followers');
      return [];
    }

    if (!res.ok) {
      log.warn({ userId, status: res.status }, 'feed_service_error');
      throw new TransientError(
        `feed-service returned ${res.status}`,
        'FEED_LOOKUP_FAILED',
      );
    }

    const data = (await res.json()) as {
      followerIds?: string[];
      followers?: Array<{ id: string }>;
    };

    // Support both response shapes:
    //   { followerIds: [...] }
    //   { followers: [{ id: ... }, ...] }
    const followerIds: string[] = data.followerIds
      ? data.followerIds
      : (data.followers ?? []).map((f) => f.id);

    // Cache
    cache.set(cacheKey, {
      followerIds,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return followerIds;
  } catch (err) {
    if (err instanceof TransientError) throw err;
    log.error({ err, userId, url }, 'feed_service_unreachable');
    throw new TransientError(
      `Failed to fetch followers for ${userId}: ${(err as Error).message}`,
      'FEED_UNREACHABLE',
    );
  }
}

export function _clearFeedCacheForTests(): void {
  cache.clear();
}