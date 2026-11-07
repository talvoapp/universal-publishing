/**
 * MongoDB connection via Mongoose.
 *
 * Exports:
 *   - `initMongo()`        — connect + verify
 *   - `closeMongo()`       — graceful disconnect
 *   - `checkMongoHealth()` — ping
 *   - `getMongoClient()`   — returns the raw MongoClient for advanced ops
 *
 * Design notes:
 *   - `autoIndex: false` in production — indexes are built via migrations,
 *     not at runtime. Prevents surprise slow startups.
 *   - `bufferCommands: false` — fail fast if queries arrive before
 *     connection is ready (they'll throw, not hang).
 *   - All Mongoose models import from here (via `mongoose.model()`), so
 *     the connection is guaranteed to be established first.
 */

import mongoose from 'mongoose';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('mongo');

// ============================================================
// STATE
// ============================================================
let connected = false;

// ============================================================
// INIT
// ============================================================
export async function initMongo(): Promise<void> {
  if (connected) return;

  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', !config.isProd);
  mongoose.set('bufferCommands', false);

  // Connection-level events
  mongoose.connection.on('connected', () => {
    log.info({ db: config.mongo.dbName }, 'MongoDB connected');
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
    connected = false;
  });
  mongoose.connection.on('reconnected', () => {
    log.info('MongoDB reconnected');
    connected = true;
  });
  mongoose.connection.on('error', (err) => {
    log.error({ err }, 'MongoDB connection error');
  });

  await mongoose.connect(config.mongo.url, {
    dbName: config.mongo.dbName,
    maxPoolSize: config.mongo.maxPool,
    serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMs,
    socketTimeoutMS: 45_000,
    connectTimeoutMS: 10_000,
    // Retry writes on transient errors (network hiccups)
    retryWrites: true,
    retryReads: true,
  });

  // Sanity check: ping the server
  const admin = mongoose.connection.db?.admin();
  if (!admin) throw new Error('MongoDB admin interface unavailable');
  const ping = await admin.ping();
  if (!ping?.ok) throw new Error('MongoDB ping failed');

  connected = true;
}

// ============================================================
// CLOSE
// ============================================================
export async function closeMongo(): Promise<void> {
  if (!connected) return;
  try {
    await mongoose.disconnect();
    log.info('MongoDB disconnected');
  } catch (err) {
    log.error({ err }, 'Error closing MongoDB');
  } finally {
    connected = false;
  }
}

// ============================================================
// HEALTH
// ============================================================
export async function checkMongoHealth(): Promise<boolean> {
  if (!connected) return false;
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const ping = await admin.ping();
    return Boolean(ping?.ok);
  } catch {
    return false;
  }
}

// ============================================================
// ACCESSOR
// ============================================================
export function getMongoClient() {
  const client = mongoose.connection.getClient();
  if (!client) throw new Error('MongoDB client not initialized');
  return client;
}

// ============================================================
// TRANSACTION HELPER
// ============================================================
/**
 * Runs `fn` inside a MongoDB transaction.
 * Requires a replica set (MongoDB 4.0+). In local dev, docker-compose
 * should start MongoDB as a single-node replica set (see init-replica.sh).
 */
export async function withMongoTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}