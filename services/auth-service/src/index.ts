/**
 * Auth Service — Entry Point
 *
 * Responsibilities:
 *   1. Load & validate config (fails fast on misconfiguration)
 *   2. Initialize the structured logger
 *   3. Initialize Sentry (if DSN provided)
 *   4. Connect to PostgreSQL & Redis (with retry)
 *   5. Start HTTP server on config.port
 *   6. Install signal handlers for graceful shutdown:
 *      - SIGTERM (Kubernetes / Docker stop)  → drain in-flight, then exit
 *      - SIGINT  (Ctrl+C / local dev)        → same
 *      - uncaughtException / unhandledRejection → log + exit(1)
 *   7. Expose /health and /ready endpoints (registered in app.ts)
 *
 * Startup order matters: we never bind the HTTP port until the DB
 * and Redis pools are ready. This guarantees that a pod that fails
 * readiness probes is never sent traffic by the load balancer.
 */

import { config } from '@/config';
import { createApp } from '@/app';
import { initPostgres, closePostgres, checkPostgresHealth } from '@/db/postgres';
import { initRedis, closeRedis, checkRedisHealth } from '@/db/redis';
import { createLogger } from '@/utils/logger';
import { initSentry, captureException } from '@/utils/sentry';

const log = createLogger('bootstrap');

// ============================================================
// 1. SENTRY (early — before anything that can throw)
// ============================================================
initSentry();

// ============================================================
// 2. GLOBAL ERROR HANDLERS (installed early so boot failures are caught)
// ============================================================
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception — shutting down');
  captureException(err);
  // Give the logger a tick to flush before exiting.
  setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason, promise) => {
  log.error({ reason, promise }, 'Unhandled rejection');
  captureException(reason);
  // Do not exit: some rejections are recoverable (e.g., a background task).
});

// ============================================================
// 3. MAIN
// ============================================================
async function main(): Promise<void> {
  log.info(
    { env: config.env, version: config.serviceVersion },
    `Starting ${config.serviceName} v${config.serviceVersion}`,
  );

  // ----- 3.1 Databases -----
  log.info('Connecting to PostgreSQL…');
  await initPostgres();
  log.info('PostgreSQL connected');

  log.info('Connecting to Redis…');
  await initRedis();
  log.info('Redis connected');

  // ----- 3.2 HTTP Server -----
  const app = createApp();

  const server = app.listen(config.port, '0.0.0.0', () => {
    log.info(
      { port: config.port, env: config.env },
      `HTTP server listening on 0.0.0.0:${config.port}`,
    );
  });

  // Safe-ish timeouts for a real-world REST service
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  // ----- 3.3 Graceful Shutdown -----
  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'Shutdown initiated');

    // 1. Stop accepting new connections
    server.close((err) => {
      if (err) log.error({ err }, 'Error closing HTTP server');
      else log.info('HTTP server closed');
    });

    // 2. Give in-flight requests up to 25 s to complete
    const forceExitTimer = setTimeout(() => {
      log.warn('Forcing shutdown after 25s grace period');
      process.exit(exitCode || 1);
    }, 25_000);
    forceExitTimer.unref();

    try {
      // 3. Close DB pools (waits for idle clients, aborts checkouts)
      await closePostgres();
      log.info('PostgreSQL pool closed');

      // 4. Close Redis (flushes pipelined commands)
      await closeRedis();
      log.info('Redis client closed');
    } catch (err) {
      log.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }

    log.info('Shutdown complete');
    clearTimeout(forceExitTimer);
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // ----- 3.4 Periodic Health Probe (for internal monitoring) -----
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

// ============================================================
// 4. GO
// ============================================================
main().catch((err) => {
  log.fatal({ err }, 'Fatal error during startup');
  captureException(err);
  // Give the logger a tick to flush before exiting.
  setTimeout(() => process.exit(1), 100);
});