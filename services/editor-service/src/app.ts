/**
 * Express application factory for editor-service.
 *
 * NOTE: This app handles HTTP only. WebSocket is attached separately
 * to the same underlying HTTP server in `index.ts` via `attachWebSocketServer`.
 *
 * Middleware order:
 *   1. HTTP request logger
 *   2. Security headers (helmet)
 *   3. CORS
 *   4. Body parsers
 *   5. Request ID
 *   6. Health / ready (before rate limiting)
 *   7. Global rate limit
 *   8. Feature routes (/api/v1/*)
 *   9. 404 handler
 *  10. Error handler
 */

import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'crypto';

import { config } from '@/config';
import { createHttpLogger, createLogger } from '@/utils/logger';
import apiRouter from '@/routes/index';
import { globalRateLimit } from '@/middleware/rate-limit.middleware';
import { notFoundHandler, errorHandler } from '@/middleware/error.middleware';
import { checkMongoHealth } from '@/db/mongo';
import { checkRedisHealth } from '@/db/redis';

const log = createLogger('app');

export function createApp(): Express {
  const app = express();

  // ------------------------------------------------------------
  // 0. TRUST PROXY
  // ------------------------------------------------------------
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ------------------------------------------------------------
  // 1. HTTP LOGGER
  // ------------------------------------------------------------
  app.use(createHttpLogger());

  // ------------------------------------------------------------
  // 2. SECURITY HEADERS
  // ------------------------------------------------------------
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
    }),
  );

  // ------------------------------------------------------------
  // 3. CORS
  // ------------------------------------------------------------
  app.use(
    cors({
      origin: (origin, callback) => {
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

  // ------------------------------------------------------------
  // 4. BODY PARSERS
  // ------------------------------------------------------------
  // Editor HTTP endpoints only handle metadata operations (no large
  // content bodies — those go through WebSocket patches).
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // ------------------------------------------------------------
  // 5. REQUEST ID
  // ------------------------------------------------------------
  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const id =
      incoming && /^[A-Za-z0-9_-]{8,128}$/.test(incoming)
        ? incoming
        : randomUUID();
    req.id = id;
    res.setHeader('X-Request-ID', id);
    next();
  });

  // ------------------------------------------------------------
  // 6. HEALTH / READY
  // ------------------------------------------------------------
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
    const [mongo, redis] = await Promise.all([
      checkMongoHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
    ]);
    const ready = mongo && redis;
    res.status(ready ? 200 : 503).json({
      ready,
      checks: {
        mongodb: mongo ? 'ok' : 'fail',
        redis: redis ? 'ok' : 'fail',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ------------------------------------------------------------
  // 7. GLOBAL RATE LIMIT
  // ------------------------------------------------------------
  app.use(globalRateLimit);

  // ------------------------------------------------------------
  // 8. API ROUTES
  // ------------------------------------------------------------
  app.use('/api/v1', apiRouter);

  // ------------------------------------------------------------
  // 9. 404 & 10. ERROR
  // ------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}