/**
 * Express app factory for notification-service.
 *
 * HTTP surface is minimal — this service is primarily a Kafka consumer.
 * Endpoints:
 *   - GET /health   — liveness
 *   - GET /ready    — readiness (Postgres + Redis + Kafka + SMTP)
 *   - GET /metrics  — Prometheus
 */

import express, { type Express, type Request, type Response } from 'express';
import { createHttpLogger } from '@/utils/logger';
import { checkPostgresHealth } from '@/db/postgres';
import { checkRedisHealth } from '@/db/redis';
import { getConsumerHealth } from '@/consumers/consumer';
import { verifyTransporter } from '@/services/smtp.service';
import { register } from 'prom-client';

export function createApp(): Express {
  const app = express();

  // Trust proxy (behind nginx / vercel)
  app.set('trust proxy', 1);

  // Disable x-powered-by
  app.disable('x-powered-by');

  // HTTP logger
  app.use(createHttpLogger());

  // JSON body parser (small limit — this service doesn't accept big payloads)
  app.use(express.json({ limit: '100kb' }));

  // ------------------------------------------------------------
  // Health (liveness)
  // ------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // ------------------------------------------------------------
  // Ready (readiness)
  // ------------------------------------------------------------
  app.get('/ready', async (_req: Request, res: Response) => {
    const [pgOk, redisOk, kafkaOk, smtpOk] = await Promise.all([
      checkPostgresHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
      Promise.resolve(getConsumerHealth()),
      verifyTransporter().catch(() => false),
    ]);

    const ready = pgOk && redisOk && kafkaOk;
    const status = ready ? 200 : 503;

    res.status(status).json({
      ready,
      checks: {
        postgres: pgOk ? 'ok' : 'fail',
        redis: redisOk ? 'ok' : 'fail',
        kafka: kafkaOk ? 'ok' : 'fail',
        smtp: smtpOk ? 'ok' : 'fail',
      },
    });
  });

  // ------------------------------------------------------------
  // Metrics (Prometheus)
  // ------------------------------------------------------------
  app.get('/metrics', async (_req: Request, res: Response) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // ------------------------------------------------------------
  // 404
  // ------------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ------------------------------------------------------------
  // Error handler
  // ------------------------------------------------------------
  app.use(
    (
      err: Error,
      _req: Request,
      res: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction,
    ) => {
      // eslint-disable-next-line no-console
      console.error('[error]', err);
      res.status(500).json({ error: 'Internal server error' });
    },
  );

  return app;
}