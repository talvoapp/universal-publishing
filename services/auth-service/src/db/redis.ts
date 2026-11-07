/**
 * Redis connection singleton + helpers.
 *
 * ioredis handles reconnection automatically. We layer a small
 * `key(prefix, ...parts)` helper on top so services don't have to
 * remember the global key prefix.
 *
 * Uses a dedicated DB index (0) for auth sessions. Other services
 * own other DB indices (see infrastructure/redis/redis.conf).
 */

import Redis, { type Redis as RedisClient } from 'ioredis';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('redis');

// ============================================================
// STATE
// ============================================================
let client: RedisClient | null = null;

// ============================================================
// INIT / CLOSE / HEALTH
// ============================================================
export async function initRedis(): Promise<void> {
  if (client) return;

  client = new Redis(config.redis.url, {
    keyPrefix: undefined, // we manage prefixes manually via `key()`
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 2000);
      log.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
      return delay;
    },
    reconnectOnError(err) {
      const target = 'READONLY';
      return err.message.includes(target);
    },
  });

  client.on('connect', () => log.info('Redis connecting…'));
  client.on('ready', () => log.info('Redis ready'));
  client.on('error', (err) => log.error({ err }, 'Redis error'));
  client.on('close', () => log.warn('Redis connection closed'));
  client.on('reconnecting', () => log.warn('Redis reconnecting'));

  // Wait for the first `ready` event before proceeding.
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
    // `quit()` sends QUIT and waits; `disconnect()` is immediate.
    // We prefer quit() to flush pipelined commands.
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

// ============================================================
// ACCESSOR
// ============================================================
/**
 * Returns the live Redis client, throwing if not initialized.
 * Called by middleware, services, etc.
 */
export function getRedisClient(): RedisClient {
  if (!client) throw new Error('Redis client not initialized');
  return client;
}

// ============================================================
// KEY HELPER
// ============================================================
/**
 * Builds a namespaced key.
 *   key('refresh', userId, tokenId) → 'auth:refresh:<userId>:<tokenId>'
 */
export function key(...parts: (string | number)[]): string {
  return `${config.redis.keyPrefix}${parts.join(':')}`;
}