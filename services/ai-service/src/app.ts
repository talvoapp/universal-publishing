/**
 * Express application factory for ai-service.
 *
 * Special attention to SSE:
 *   - No global body limit is required for streaming responses, but the
 *     REQUEST body (prompt + instruction) is limited to 500 KB.
 *   - Compression must NOT be enabled globally (it would buffer SSE chunks).
 *   - The `/api/v1/ai/*` endpoints set their own SSE headers.
 *   - Middleware disables any response buffering (`X-Accel-Buffering: no`)
 *     to work correctly behind Nginx.
 *
 * Health/ready endpoints are placed BEFORE the rate limiter so that
 * orchestrator probes never get rate-limited.
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
import { checkRedisHealth } from '@/db/redis';

const log = createLogger('app');

export function createApp(): Express {
  const app = express();

  // ------------------------------------------------------------
  // 0. TRUST PROXY + DISABLE X-POWERED-BY
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
  // 3. CORS (SSE clients need credentials)
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
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      exposedHeaders: [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
        'X-AI-Quota-Limit',
        'X-AI-Quota-Remaining',
        'X-AI-Quota-Reset',
      ],
      maxAge: 86_400,
    }),
  );

  // ------------------------------------------------------------
  // 4. BODY PARSERS
  // ------------------------------------------------------------
  // Prompts can be long (a full chapter of context). 500 KB is generous
  // but still bounded. SSE responses are streamed (no body parser for them).
  app.use(express.json({ limit: '500kb', strict: true }));
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
  // 6. GLOBAL SSE-FRIENDLY HEADERS
  // ------------------------------------------------------------
  // Every response (including non-SSE) gets `X-Accel-Buffering: no` so
  // that Nginx (in front of us) does not buffer SSE chunks.
  app.use((_req, res, next) => {
    res.setHeader('X-Accel-Buffering', 'no');
    next();
  });

  // ------------------------------------------------------------
  // 7. HEALTH / READY (before rate limiting)
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
    const redis = await checkRedisHealth().catch(() => false);
    res.status(redis ? 200 : 503).json({
      ready: redis,
      checks: { redis: redis ? 'ok' : 'fail' },
      timestamp: new Date().toISOString(),
    });
  });

  // ------------------------------------------------------------
  // 8. GLOBAL RATE LIMIT
  // ------------------------------------------------------------
  app.use(globalRateLimit);

  // ------------------------------------------------------------
  // 9. API ROUTES
  // ------------------------------------------------------------
  app.use('/api/v1', apiRouter);

  // ------------------------------------------------------------
  // 10. 404 & ERROR
  // ------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}