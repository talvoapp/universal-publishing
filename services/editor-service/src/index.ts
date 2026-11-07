/**
 * Editor Service — Entry Point
 *
 * Starts TWO listeners on the same HTTP server:
 *   1. Express app on `/api/v1/editor/*`, `/api/v1/taxonomy/*`
 *   2. WebSocket server on `config.ws.path` (`/editor/stream`)
 *
 * Startup order:
 *   1. Config (already validated on import)
 *   2. Sentry (optional)
 *   3. Logger
 *   4. MongoDB (Mongoose) — must be ready before accepting traffic
 *   5. Redis
 *   6. HTTP server (Express + WebSocket attached)
 *   7. Graceful shutdown handlers
 */

import http from 'http';
import { config } from '@/config';
import { createApp } from '@/app';
import { initMongo, closeMongo, checkMongoHealth } from '@/db/mongo';
import { initRedis, closeRedis, checkRedisHealth } from '@/db/redis';
import { attachWebSocketServer, closeWebSocketServer } from '@/websocket/handler';
import { initOutboxPublisher, closeOutboxPublisher } from '@/outbox/publisher';
import { createLogger } from '@/utils/logger';
import { initSentry, captureException, flushSentry } from '@/utils/sentry';

const log = createLogger('bootstrap');

// ============================================================
// 1. GLOBAL ERROR HANDLERS
// ============================================================
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception — shutting down');
  captureException(err);
  setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled rejection');
  captureException(reason);
});

// ============================================================
// 2. MAIN
// ============================================================
async function main(): Promise<void> {
  initSentry();

  log.info(
    { env: config.env, version: config.serviceVersion },
    `Starting ${config.serviceName} v${config.serviceVersion}`,
  );

  // ----- Mongo -----
  log.info('Connecting to MongoDB…');
  await initMongo();
  log.info('MongoDB connected');

  // ----- Redis -----
  log.info('Connecting to Redis…');
  await initRedis();
  log.info('Redis connected');

  // ----- Outbox publisher (Kafka) -----
  log.info('Initializing outbox publisher…');
  await initOutboxPublisher();
  log.info('Outbox publisher ready');

  // ----- HTTP + WebSocket -----
  const app = createApp();
  const server = http.createServer(app);

  attachWebSocketServer(server);

  server.listen(config.port, '0.0.0.0', () => {
    log.info(
      { port: config.port, wsPath: config.ws.path },
      `HTTP + WebSocket listening on 0.0.0.0:${config.port} (ws: ${config.ws.path})`,
    );
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  // ----- Graceful shutdown -----
  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'Shutdown initiated');

    // Force exit if we get stuck
    const forceExit = setTimeout(() => {
      log.warn('Forcing shutdown after 30s grace period');
      process.exit(exitCode || 1);
    }, 30_000);
    forceExit.unref();

    try {
      // 1. Close WebSocket server first — this sends close frames to all
      //    connected peers so their clients see a clean disconnect.
      await closeWebSocketServer();

      // 2. Stop accepting new HTTP connections, wait for in-flight
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      // 3. Flush outbox, then close Kafka
      await closeOutboxPublisher();

      // 4. Close Redis
      await closeRedis();

      // 5. Close Mongo last (its buffered writes may still be flushing)
      await closeMongo();

      // 6. Flush Sentry
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

  // ----- Periodic health probe -----
  const healthInterval = setInterval(async () => {
    const [mongoOk, redisOk] = await Promise.all([
      checkMongoHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
    ]);
    if (!mongoOk || !redisOk) {
      log.warn({ mongoOk, redisOk }, 'Health probe: dependency unhealthy');
    }
  }, 30_000);
  healthInterval.unref();
}

// ============================================================
// 3. GO
// ============================================================
main().catch((err) => {
  log.fatal({ err }, 'Fatal error during startup');
  captureException(err);
  setTimeout(() => process.exit(1), 100);
});