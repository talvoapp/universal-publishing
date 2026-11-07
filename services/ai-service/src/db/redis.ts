/**
 * Redis client for ai-service.
 *
 * Uses DB 2 (see infrastructure/redis/redis.conf):
 *   0 → auth
 *   1 → editor
 *   2 → ai (THIS)
 *   3 → marketplace
 *   4 → entitlement
 *   5 → feed
 *   6 → notifications
 *
 * Beyond the standard init/close/health, this module exposes helpers
 * specific to AI:
 *   - `quotaKey(userId, ymd)` — daily quota counter
 *   - `sseSessionKey(sessionId)` — SSE resume state
 *   - `providerHealthKey(provider)` — circuit breaker state
 */

import Redis, { type Redis as RedisClient } from 'ioredis';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('redis');

let client: RedisClient | null = null;

// ============================================================
// INIT / CLOSE / HEALTH
// ============================================================
export async function initRedis(): Promise<void> {
  if (client) return;

  client = new Redis(config.redis.url, {
    keyPrefix: undefined,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 2000);
      log.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    reconnectOnError(err) {
      return err.message.includes('READONLY');
    },
  });

  client.on('connect', () => log.info('Redis connecting…'));
  client.on('ready', () => log.info('Redis ready'));
  client.on('error', (err) => log.error({ err }, 'Redis error'));
  client.on('close', () => log.warn('Redis connection closed'));
  client.on('reconnecting', () => log.warn('Redis reconnecting'));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Redis did not become ready within 10s')),
      10_000,
    );
    client!.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
    client!.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.quit();
    log.info('Redis client closed');
  } catch (err) {
    log.error({ err }, 'Error closing Redis; forcing disconnect');
    c.disconnect();
  }
}

export async function checkRedisHealth(): Promise<boolean> {
  if (!client) return false;
  try {
    const pong = await client.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export function getRedisClient(): RedisClient {
  if (!client) throw new Error('Redis client not initialized');
  return client;
}

// ============================================================
// KEY BUILDERS
// ============================================================
export function key(...parts: (string | number)[]): string {
  return `${config.redis.keyPrefix}${parts.join(':')}`;
}

/** Daily quota counter — reset at UTC midnight via TTL */
export function quotaKey(userId: string, ymd: string): string {
  return key('quota', userId, ymd);
}

/** SSE resume session state */
export function sseSessionKey(sessionId: string): string {
  return key('sse', 'session', sessionId);
}

/** Circuit breaker state per provider */
export function providerHealthKey(provider: string): string {
  return key('provider', 'health', provider);
}

/** Rate limit bucket per user (in addition to HTTP-level limiter) */
export function userRateKey(userId: string): string {
  return key('rl', 'user', userId);
}