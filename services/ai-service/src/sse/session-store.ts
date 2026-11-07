/**
 * SSE session store — Redis-backed resume state.
 *
 * Purpose:
 *   When a client's SSE connection drops mid-stream (network blip,
 *   tab reload, mobile backgrounding), they can re-POST with the same
 *   `sessionId` and the server will:
 *     1. Look up the session's saved state (accumulated text + index).
 *     2. If the stream is still running (another request from same user
 *        is active), reject with 409 — only ONE active stream per session.
 *     3. If the stream completed, return the full accumulated text and
 *        a `done` event immediately (idempotent replay).
 *     4. If the stream was abandoned, restart and replay the saved
 *        prefix first, then continue from where the provider left off.
 *        (Full resume of the provider stream is complex; we do best-effort.)
 *
 * Storage layout (Redis, DB 2):
 *   ai:sse:session:{sessionId}   → JSON {
 *     userId, operation, status, accumulated, lastIndex,
 *     tokensIn, tokensOut, provider, model, startedAt, updatedAt
 *   }
 *   TTL = config.sse.sessionTtlSeconds (default 600 s = 10 min)
 *
 * Concurrency:
 *   We use SET NX with a short TTL as a lightweight lock to prevent
 *   two concurrent requests from the same session. This is intentionally
 *   simple — we don't need to be perfectly atomic, because the worst case
 *   is a duplicate stream that we detect on the second write.
 */

import { getRedisClient, sseSessionKey } from '@/db/redis';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('sse.session-store');

// ============================================================
// TYPES
// ============================================================
export type SessionStatus = 'streaming' | 'completed' | 'aborted' | 'failed';

export interface SSESession {
  sessionId: string;
  userId: string;
  operation: string;
  status: SessionStatus;
  accumulated: string;   // full text emitted so far (for resume)
  lastIndex: number;     // index of the last emitted chunk
  tokensIn: number;
  tokensOut: number;
  provider: string | null;
  model: string | null;
  startedAt: string;     // ISO 8601
  updatedAt: string;
}

// ============================================================
// LOCK (per-session, prevents concurrent streams)
// ============================================================
const LOCK_SUFFIX = ':lock';
const LOCK_TTL_SECONDS = 30;

export async function acquireSessionLock(sessionId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = sseSessionKey(sessionId) + LOCK_SUFFIX;
  try {
    const result = await redis.set(key, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    log.warn({ err, sessionId }, 'Failed to acquire session lock');
    // Fail-open: if Redis is having issues, don't block the user.
    return true;
  }
}

export async function releaseSessionLock(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  const key = sseSessionKey(sessionId) + LOCK_SUFFIX;
  try {
    await redis.del(key);
  } catch (err) {
    log.warn({ err, sessionId }, 'Failed to release session lock');
  }
}

// ============================================================
// CREATE / UPDATE / GET / DELETE
// ============================================================
export async function createSession(input: {
  sessionId: string;
  userId: string;
  operation: string;
}): Promise<SSESession> {
  const now = new Date().toISOString();
  const session: SSESession = {
    sessionId: input.sessionId,
    userId: input.userId,
    operation: input.operation,
    status: 'streaming',
    accumulated: '',
    lastIndex: -1,
    tokensIn: 0,
    tokensOut: 0,
    provider: null,
    model: null,
    startedAt: now,
    updatedAt: now,
  };
  await saveSession(session);
  return session;
}

export async function getSession(sessionId: string): Promise<SSESession | null> {
  const redis = getRedisClient();
  const key = sseSessionKey(sessionId);
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as SSESession;
  } catch (err) {
    log.warn({ err, sessionId }, 'Failed to read session');
    return null;
  }
}

export async function saveSession(session: SSESession): Promise<void> {
  const redis = getRedisClient();
  const key = sseSessionKey(session.sessionId);
  const now = new Date().toISOString();
  session.updatedAt = now;
  const ttl = config.sse.sessionTtlSeconds;
  try {
    await redis.set(key, JSON.stringify(session), 'EX', ttl);
  } catch (err) {
    log.warn({ err, sessionId: session.sessionId }, 'Failed to save session');
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  const key = sseSessionKey(sessionId);
  try {
    await redis.del(key);
  } catch (err) {
    log.warn({ err, sessionId }, 'Failed to delete session');
  }
}

// ============================================================
// APPEND HELPERS
// ============================================================
/**
 * Append a delta chunk to the session's accumulated text and bump
 * the index. Returns the new index. Callers use this to keep the
 * session in sync with what was sent over the wire.
 */
export async function appendChunk(
  session: SSESession,
  delta: string,
): Promise<number> {
  session.accumulated += delta;
  session.lastIndex += 1;
  // Throttle persistence: save every 10 chunks or at the end.
  // Otherwise we'd hit Redis on every token.
  if (session.lastIndex % 10 === 0) {
    await saveSession(session);
  }
  return session.lastIndex;
}

export async function markCompleted(
  session: SSESession,
  usage: { tokensIn: number; tokensOut: number; provider: string; model: string },
): Promise<void> {
  session.status = 'completed';
  session.tokensIn = usage.tokensIn;
  session.tokensOut = usage.tokensOut;
  session.provider = usage.provider;
  session.model = usage.model;
  await saveSession(session);
}

export async function markFailed(
  session: SSESession,
  reason: string,
): Promise<void> {
  session.status = 'failed';
  await saveSession(session);
  log.warn({ sessionId: session.sessionId, reason }, 'Session marked failed');
}

export async function markAborted(session: SSESession): Promise<void> {
  session.status = 'aborted';
  await saveSession(session);
}