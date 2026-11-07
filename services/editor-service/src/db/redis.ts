/**
 * Redis client for editor-service.
 *
 * Uses DB 1 (see infrastructure/redis/redis.conf):
 *   0 → auth sessions
 *   1 → editor presence, authz cache, patch coalesce buffers
 *   2 → AI quotas
 *   3 → marketplace
 *   4 → entitlement
 *   5 → feed
 *   6 → notifications
 *
 * Key helper wraps the global prefix so every call site stays clean.
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
      // After a failover, the connection may still be pointed at a
      // demoted replica (READONLY). Force reconnect to refresh topology.
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

// ============================================================
// ACCESSOR
// ============================================================
export function getRedisClient(): RedisClient {
  if (!client) throw new Error('Redis client not initialized');
  return client;
}

// ============================================================
// KEY BUILDER
// ============================================================
export function key(...parts: (string | number)[]): string {
  return `${config.redis.keyPrefix}${parts.join(':')}`;
}