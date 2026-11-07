/**
 * Rate limiters.
 *
 * Design principles:
 *   1. One limiter per endpoint class (not one per route).
 *   2. `skipSuccessfulRequests` on auth endpoints — a legitimate user
 *      who logs in successfully should not be penalized.
 *   3. Redis-backed store in production → consistent across replicas.
 *   4. In development / test we fall back to the in-memory store so
 *      no Redis is required to run the service locally.
 *   5. All limiters emit standard `X-RateLimit-*` headers and a
 *      proper `Retry-After` on 429.
 */

import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import RedisStore from 'rate-limit-redis';
import { config } from '@/config';
import { getRedisClient } from '@/db/redis';
import { createLogger } from '@/utils/logger';

const log = createLogger('rate-limit');

// ============================================================
// SHARED HELPERS
// ============================================================
const standardHeaders = true;
const legacyHeaders = false;

function jsonHandler(req: Request, res: Response): void {
  const retryAfter = res.getHeader('Retry-After');
  log.warn(
    { ip: req.ip, path: req.path, retryAfter },
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

/**
 * Builds a limiter with sensible defaults. Falls back to memory store
 * in dev/test (Redis-store used in production).
 */
function makeLimiter(opts: {
  windowMs: number;
  max: number;
  prefix: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}): RateLimitRequestHandler {
  const useRedis = config.isProd;

  let store: rateLimit.Store | undefined;
  if (useRedis) {
    try {
      const redis = getRedisClient();
      store = new RedisStore({
        // ioredis exposes `call` (v5+) — route through it
        sendCommand: (...args: string[]) =>
          (redis as unknown as { call: (...a: string[]) => Promise<unknown> }).call(...args) as Promise<never>,
        prefix: `${config.redis.keyPrefix}rl:${opts.prefix}:`,
      });
    } catch (err) {
      // If Redis isn't ready yet, memory-store is safer than crashing.
      log.error({ err }, 'Redis rate-limit store unavailable; using memory store');
    }
  }

  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders,
    legacyHeaders,
    skipSuccessfulRequests: opts.skipSuccessfulRequests ?? false,
    skipFailedRequests: opts.skipFailedRequests ?? false,
    handler: jsonHandler,
    // Key by IP + route prefix so different endpoints don't share budget.
    keyGenerator: (req) => `${req.ip ?? 'unknown'}:${opts.prefix}`,
    // Never block health probes or metrics.
    skip: (req) =>
      req.path === '/health' ||
      req.path === '/ready' ||
      req.path === '/metrics',
    ...(store ? { store } : {}),
  });
}

// ============================================================
// GLOBAL (broad safety net — applies to /api/v1/*)
// ============================================================
export const globalRateLimit: RateLimitRequestHandler = makeLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  prefix: 'global',
});

// ============================================================
// AUTH — general (logout, verify, etc.)
// ============================================================
export const authRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 15 * 60_000,
  max: 30,
  prefix: 'auth',
  skipSuccessfulRequests: true,
});

// ============================================================
// LOGIN — brute-force defense
// ============================================================
/**
 * 5 failed attempts per 15 min per IP.
 * Successful logins do not count (skipSuccessfulRequests).
 */
export const loginRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  prefix: 'login',
  skipSuccessfulRequests: true,
});

// ============================================================
// REGISTER — anti-abuse
// ============================================================
/**
 * 5 new accounts per hour per IP.
 * Successful registrations DO count (creating accounts is the abuse).
 */
export const registerRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  prefix: 'register',
  skipSuccessfulRequests: false,
});

// ============================================================
// PASSWORD RESET (forgot / reset)
// ============================================================
/**
 * 3 requests per hour per IP — email sending is expensive.
 */
export const passwordResetRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 60_000,
  max: 3,
  prefix: 'pwreset',
  skipSuccessfulRequests: false,
});

// ============================================================
// TOKEN REFRESH
// ============================================================
/**
 * 30 refreshes per minute per IP. Legit clients typically refresh
 * every 15 min per session; 30/min is generous headroom for multiple
 * tabs.
 */
export const refreshRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60_000,
  max: 30,
  prefix: 'refresh',
});

// ============================================================
// PROFILE UPDATES
// ============================================================
/**
 * 10 profile updates per minute per IP. Prevents enumeration of
 * displayName uniqueness checks.
 */
export const profileUpdateRateLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60_000,
  max: 10,
  prefix: 'profile',
  skipSuccessfulRequests: true,
});