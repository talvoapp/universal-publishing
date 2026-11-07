/**
 * Rate limiters for ai-service.
 *
 * Design:
 *   - The GLOBAL limiter is a broad safety net (100/min/IP).
 *   - The SUGGEST limiter is the important one: 2 requests/sec per user
 *     (not per IP — users can be behind NAT). This is on top of the
 *     token quota, which is the primary cost-control mechanism.
 *   - The FEEDBACK limiter is generous (60/min) — feedback is cheap.
 *
 * Why both per-IP (global) AND per-user (suggest)?
 *   - Global per-IP: prevents anonymous DDoS.
 *   - Per-user: prevents one user from opening many tabs and hammering
 *     the endpoint even if their token quota isn't exhausted yet (e.g.,
 *     free tier with long max_tokens).
 *
 * Store: Redis in prod (consistent across replicas), memory in dev/test.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import RedisStore from 'rate-limit-redis';
import { config } from '@/config';
import { getRedisClient } from '@/db/redis';
import { createLogger } from '@/utils/logger';

const log = createLogger('rate-limit');

// ============================================================
// HELPERS
// ============================================================
function jsonHandler(req: Request, res: Response): void {
  log.warn(
    { ip: req.ip, userId: req.user?.id, path: req.path },
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
  keyByUserId?: boolean;
}): RateLimitRequestHandler {
  let store: rateLimit.Store | undefined;

  if (config.isProd) {
    try {
      const redis = getRedisClient();
      store = new RedisStore({
        sendCommand: (...args: string[]) =>
          (redis as unknown as { call: (...a: string[]) => Promise<unknown> })
            .call(...args) as Promise<never>,
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
    handler: jsonHandler,
    keyGenerator: (req) => {
      if (opts.keyByUserId && req.user?.id) {
        return `user:${req.user.id}:${opts.prefix}`;
      }
      return `${req.ip ?? 'unknown'}:${opts.prefix}`;
    },
    skip: (req) =>
      req.path === '/health' ||
      req.path === '/ready' ||
      req.path === '/metrics',
    ...(store ? { store } : {}),
  });
}

// ============================================================
// GLOBAL — 100/min per IP
// ============================================================
export const globalRateLimit: RateLimitRequestHandler = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  prefix: 'global',
});

// ============================================================
// SUGGEST — 2/sec per USER (not per IP)
// ============================================================
/**
 * This is intentionally tight: the token quota is the primary limit,
 * but 2/sec prevents a single user from opening 20 tabs and racing
 * requests that all pass the quota check before any of them completes.
 */
export const suggestRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 1000,
  max: 2,
  prefix: 'suggest',
  keyByUserId: true,
});

// ============================================================
// FEEDBACK — 60/min per user
// ============================================================
export const feedbackRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60_000,
  max: 60,
  prefix: 'feedback',
  keyByUserId: true,
});