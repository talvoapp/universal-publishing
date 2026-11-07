/**
 * Rate limiters for editor-service.
 *
 * Design mirrors auth-service:
 *   - Redis store in prod, memory in dev/test
 *   - Per-endpoint budget (IP + prefix key)
 *   - Health/ready bypassed
 *
 * Editor-specific concerns:
 *   - Draft creation is cheap for us but a DoS vector for storage.
 *   - Publishing is expensive (triggers outbox events, feed updates).
 *   - Revert is rare but has high write cost (creates new version).
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import RedisStore from 'rate-limit-redis';
import { config } from '@/config';
import { getRedisClient } from '@/db/redis';
import { createLogger } from '@/utils/logger';

const log = createLogger('rate-limit');

function jsonHandler(req: Request, res: Response): void {
  log.warn(
    { ip: req.ip, path: req.path, retryAfter: res.getHeader('Retry-After') },
    'Rate limit exceeded',
  );
  res.status(429).json({
    type: 'https://httpstatuses.io/429',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Rate limit exceeded. Please retry after the indicated window.',
    instance: req.id,
  });
}

function makeLimiter(opts: {
  windowMs: number;
  max: number;
  prefix: string;
  skipSuccessfulRequests?: boolean;
}): RateLimitRequestHandler {
  let store: rateLimit.Store | undefined;

  if (config.isProd) {
    try {
      const redis = getRedisClient();
      store = new RedisStore({
        sendCommand: (...args: string[]) =>
          (redis as unknown as { call: (...a: string[]) => Promise<unknown> }).call(...args) as Promise<never>,
        prefix: `${config.redis.keyPrefix}rl:${opts.prefix}:`,
      });
    } catch (err) {
      log.error({ err }, 'Redis rate-limit store unavailable; using memory store');
    }
  }

  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
    handler: jsonHandler,
    keyGenerator: (req) => `${req.ip ?? 'unknown'}:${opts.prefix}`,
    skip: (req) =>
      req.path === '/health' ||
      req.path === '/ready' ||
      req.path === '/metrics',
    ...(store ? { store } : {}),
  });
}

// ============================================================
// GLOBAL
// ============================================================
export const globalRateLimit: RateLimitRequestHandler = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  prefix: 'global',
});

// ============================================================
// DRAFT CREATE — 20 drafts per hour per IP
// ============================================================
export const draftCreateRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 60_000,
  max: 20,
  prefix: 'draft-create',
});

// ============================================================
// PUBLISH — 10 publishes per hour per IP
// (expensive: emits outbox events)
// ============================================================
export const publishRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  prefix: 'publish',
  skipSuccessfulRequests: false,
});

// ============================================================
// REVERT — 10 reverts per hour per IP
// ============================================================
export const revertRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  prefix: 'revert',
});