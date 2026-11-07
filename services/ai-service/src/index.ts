/**
 * AI Service — Entry Point
 *
 * Responsibilities:
 *   1. Load & validate config (fails fast on misconfiguration)
 *   2. Initialize logger + Sentry
 *   3. Connect to Redis (quota counters, session resume store)
 *   4. Start HTTP server (SSE endpoints + quota queries)
 *   5. Graceful shutdown: drain in-flight SSE streams, then exit
 *
 * Startup order matters: Redis must be ready before we accept traffic,
 * because every request checks + updates the quota counter.
 *
 * NOTE: This service does NOT use a database. All state lives in Redis
 * (quotas, SSE resume sessions). AI provider data is not persisted —
 * conversations are ephemeral; only aggregated usage is stored.
 */

import { config } from '@/config';
import { createApp } from '@/app';
import { initRedis, closeRedis, checkRedisHealth } from '@/db/redis';
import { createLogger } from '@/utils/logger';
import { initSentry, captureException, flushSentry } from '@/utils/sentry';
import { closeAllStreams } from '@/sse/stream.handler';

const log = createLogger('bootstrap');

// ============================================================
// GLOBAL ERROR HANDLERS
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
// MAIN
// ============================================================
async function main(): Promise<void> {
  initSentry();

  log.info(
    { env: config.env, version: config.serviceVersion },
    `Starting ${config.serviceName} v${config.serviceVersion}`,
  );

  // ----- Redis -----
  log.info('Connecting to Redis…');
  await initRedis();
  log.info('Redis connected');

  // ----- HTTP Server -----
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    log.info(
      { port: config.port },
      `HTTP server listening on 0.0.0.0:${config.port}`,
    );
  });

  // SSE requires disabling timeouts on the underlying socket.
  // Node's default requestTimeout (300s) would kill long-lived streams.
  server.requestTimeout = 0;
  server.headersTimeout = 66_000;
  server.keepAliveTimeout = 65_000;
  server.timeout = 0;

  // ----- Graceful shutdown -----
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
      // 1. Signal all active SSE streams to terminate gracefully.
      //    They will send a final `error` event with `retryable: false`
      //    and a `code: 'server_shutting_down'` before closing.
      await closeAllStreams('server_shutting_down');

      // 2. Stop accepting new connections.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });

      // 3. Close Redis.
      await closeRedis();

      // 4. Flush Sentry.
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
    const redisOk = await checkRedisHealth().catch(() => false);
    if (!redisOk) log.warn({ redisOk }, 'Health probe: Redis unhealthy');
  }, 30_000);
  healthInterval.unref();
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error during startup');
  captureException(err);
  setTimeout(() => process.exit(1), 100);
});