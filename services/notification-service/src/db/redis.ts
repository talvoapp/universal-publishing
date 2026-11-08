/**
 * Redis connection + helpers.
 *
 * Used for:
 *   - Email rate limiting (per-recipient)
 *   - Dedup of Kafka events (in addition to processed_events in Postgres)
 *   - Cooldown between identical notifications
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
  });

  client.on('connect', () => log.info('Redis connecting…'));
  client.on('ready', () => log.info('Redis ready'));
  client.on('error', (err) => log.error({ err }, 'Redis error'));
  client.on('close', () => log.warn('Redis connection closed'));

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
    log.error({ err }, 'Error closing Redis');
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

/** Per-recipient email rate-limit counter */
export function emailRateKey(recipientId: string): string {
  return key('email-rate', recipientId);
}

/** Dedup key for a specific (event, recipient, channel) combo */
export function dedupKey(
  eventId: string,
  recipientId: string,
  channel: string,
): string {
  return key('dedup', eventId, recipientId, channel);
}

// ============================================================
// RATE LIMITING
// ============================================================
/**
 * Checks and increments the per-recipient email rate limit.
 * Returns true if allowed, false if exceeded.
 *
 * Uses a sliding 1-hour window (approximated with fixed window buckets).
 */
export async function checkEmailRateLimit(
  recipientId: string,
  limitPerHour: number,
): Promise<boolean> {
  if (!client) throw new Error('Redis client not initialized');
  const k = emailRateKey(recipientId);
  const count = await client.incr(k);
  if (count === 1) {
    await client.expire(k, 3600);
  }
  return count <= limitPerHour;
}

// ============================================================
// DEDUP
// ============================================================
/**
 * Marks a (event, recipient, channel) combo as processed.
 * Returns true if newly set (allowed), false if already existed.
 *
 * TTL = 24 hours (same as processed_events in Postgres).
 */
export async function tryDedup(
  eventId: string,
  recipientId: string,
  channel: string,
): Promise<boolean> {
  if (!client) throw new Error('Redis client not initialized');
  const k = dedupKey(eventId, recipientId, channel);
  const result = await client.set(k, '1', 'EX', 86400, 'NX');
  return result === 'OK';
}