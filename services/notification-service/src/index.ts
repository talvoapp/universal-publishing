/**
 * Notification Service — Entry Point.
 */

import http from 'http';
import { config } from '@/config';
import { createApp } from '@/app';
import { initPostgres, closePostgres, checkPostgresHealth } from '@/db/postgres';
import { initRedis, closeRedis, checkRedisHealth } from '@/db/redis';
import { createConsumer, closeConsumer } from '@/consumers/consumer';
import { closeTransporter } from '@/services/smtp.service';
import { createLogger } from '@/utils/logger';
import { initSentry, captureException, flushSentry } from '@/utils/sentry';

const log = createLogger('bootstrap');

process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception — shutting down');
  captureException(err);
  setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled rejection');
  captureException(reason);
});

async function main(): Promise<void> {
  initSentry();

  log.info(
    { env: config.env, version: config.serviceVersion },
    `Starting ${config.serviceName} v${config.serviceVersion}`,
  );

  log.info('Connecting to PostgreSQL…');
  await initPostgres();
  log.info('PostgreSQL connected');

  log.info('Connecting to Redis…');
  await initRedis();
  log.info('Redis connected');

  log.info('Starting Kafka consumer…');
  const consumer = await createConsumer();
  await consumer.start();
  log.info('Kafka consumer ready');

  const app = createApp();
  const server = http.createServer(app);

  server.listen(config.port, '0.0.0.0', () => {
    log.info({ port: config.port }, `HTTP server listening on 0.0.0.0:${config.port}`);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'Shutdown initiated');

    const forceExit = setTimeout(() => {
      log.warn('Forcing shutdown after 30s grace period');
      process.exit(exitCode || 1);
    }, 30_000);
    forceExit.unref();

    try {
      // 1. Stop Kafka consumer (finishes current message, commits offset).
      await closeConsumer();
      log.info('Kafka consumer stopped');

      // 2. Close SMTP transporter (flush in-flight emails).
      await closeTransporter();
      log.info('SMTP transporter closed');

      // 3. Stop HTTP.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      log.info('HTTP server stopped');

      // 4. Close Redis.
      await closeRedis();
      log.info('Redis closed');

      // 5. Close Postgres.
      await closePostgres();
      log.info('Postgres closed');

      // 6. Flush Sentry.
      await flushSentry();
    } catch (err) {
      log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }

    clearTimeout(forceExit);
    log.info('Shutdown complete');
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const healthInterval = setInterval(async () => {
    const [pgOk, redisOk] = await Promise.all([
      checkPostgresHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
    ]);
    if (!pgOk || !redisOk) {
      log.warn({ pgOk, redisOk }, 'Health probe: dependency unhealthy');
    }
  }, 30_000);
  healthInterval.unref();
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error during startup');
  captureException(err);
  setTimeout(() => process.exit(1), 100);
});