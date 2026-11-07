/**
 * Express application factory.
 *
 * Middleware order matters — this is the canonical order:
 *   1. Sentry request handler        (trace context)
 *   2. HTTP request logger           (pino-http)
 *   3. Helmet                        (security headers)
 *   4. CORS                          (origin allowlist)
 *   5. Body parsers                  (JSON with size limit)
 *   6. Cookie parser                 (HttpOnly refresh tokens)
 *   7. Request ID                    (propagate / generate X-Request-ID)
 *   8. Global rate limiter           (broad safety net)
 *   9. Health endpoints              (/health, /ready — no auth)
 *  10. Feature routes                (/api/v1/*)
 *  11. 404 handler
 *  12. Error handler                 (must be LAST)
 *
 * Everything here is stateless — safe to create multiple apps
 * in tests or spin up multiple in one process.
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';

import { config } from '@/config';
import { createHttpLogger, createLogger } from '@/utils/logger';
import apiRouter from '@/routes/index';
import { globalRateLimit } from '@/middleware/rate-limit.middleware';
import { notFoundHandler, errorHandler } from '@/middleware/error.middleware';
import { checkPostgresHealth } from '@/db/postgres';
import { checkRedisHealth } from '@/db/redis';

const log = createLogger('app');

export function createApp(): Express {
  const app = express();

  // ==========================================================
  // 0. TRUST PROXY (behind Nginx/ALB)
  // ==========================================================
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ==========================================================
  // 1. HTTP LOGGER
  // ==========================================================
  app.use(createHttpLogger());

  // ==========================================================
  // 2. SECURITY HEADERS
  // ==========================================================
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProd
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      noSniff: true,
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      xssFilter: true,
    }),
  );

  // ==========================================================
  // 3. CORS
  // ==========================================================
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (curl, server-to-server)
        if (!origin) return callback(null, true);
        if (config.cors.origins.includes(origin)) return callback(null, true);
        log.warn({ origin }, 'CORS blocked origin');
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-ID',
        'Idempotency-Key',
        'If-Match',
      ],
      exposedHeaders: [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
      ],
      maxAge: 86_400,
    }),
  );

  // ==========================================================
  // 4. BODY PARSERS (with size limit)
  // ==========================================================
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // ==========================================================
  // 5. COOKIE PARSER (refresh tokens)
  // ==========================================================
  app.use(cookieParser());

  // ==========================================================
  // 6. REQUEST ID
  // ==========================================================
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const id = incoming && /^[A-Za-z0-9_-]{8,128}$/.test(incoming)
      ? incoming
      : randomUUID();
    req.id = id;
    res.setHeader('X-Request-ID', id);
    next();
  });

  // ==========================================================
  // 7. HEALTH & READINESS (BEFORE rate limiting)
  // ==========================================================
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: config.serviceName,
      version: config.serviceVersion,
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req, res) => {
    const [pg, redis] = await Promise.all([
      checkPostgresHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
    ]);
    const ready = pg && redis;
    res.status(ready ? 200 : 503).json({
      ready,
      checks: {
        postgres: pg ? 'ok' : 'fail',
        redis: redis ? 'ok' : 'fail',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================================
  // 8. GLOBAL RATE LIMITER (broad safety net)
  // ==========================================================
  app.use(globalRateLimit);

  // ==========================================================
  // 9. API ROUTES
  // ==========================================================
  app.use('/api/v1', apiRouter);

  // ==========================================================
  // 10. 404 & ERROR HANDLERS (order: 404 → error)
  // ==========================================================
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}