/**
 * Session — per-connection state machine.
 *
 * A `Session` is created on connection and destroyed on close.
 * It tracks:
 *   - Authentication status (userId, role, emailVerified)
 *   - Current subscription (draftId, last known version)
 *   - Heartbeat state (lastPongAt)
 *   - Rate limiting (handled in handler.ts)
 *
 * Session lifecycle functions:
 *   - `createSession()`       — on `connection`
 *   - `subscribeToDraft()`    — on `subscribe` frame
 *   - `authorizeDraftAccess()` — checks ownership/collaboration
 *   - `destroySession()`      — on `close` (idempotent)
 */

import type { WebSocket } from 'ws';
import { Types } from 'mongoose';
import { DraftModel, DraftDoc } from '@/models/Draft.model';
import { DraftOpModel } from '@/models/DraftOp.model';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { getRedisClient, key } from '@/db/redis';

const log = createLogger('websocket.session');

// ============================================================
// TYPES
// ============================================================
export interface Session {
  connectionId: string;
  ws: WebSocket;
  remoteAddress: string;

  // Auth (null until `auth` frame)
  userId: string | null;
  role: 'reader' | 'author' | 'editor' | 'admin' | null;
  emailVerified: boolean;

  // Subscription (null until `subscribe` frame)
  draftId: string | null;
  lastKnownVersion: number;

  // Heartbeat
  lastPongAt: number;
  createdAt: number;
}

// ============================================================
// CREATE / DESTROY
// ============================================================
export function createSession(
  ws: WebSocket,
  connectionId: string,
  remoteAddress: string,
): Session {
  return {
    connectionId,
    ws,
    remoteAddress,
    userId: null,
    role: null,
    emailVerified: false,
    draftId: null,
    lastKnownVersion: 0,
    lastPongAt: Date.now(),
    createdAt: Date.now(),
  };
}

export async function destroySession(session: Session): Promise<void> {
  // Remove from presence set
  if (session.draftId && session.userId) {
    try {
      // Lazy import to avoid circular dependency
      const presence = await import('@/websocket/presence');
      await presence.removeUser(
        session.draftId,
        session.userId,
        session.connectionId,
      );
      await presence.broadcast(
        session.draftId,
        // Get all sessions currently subscribed to this draft
        (await import('@/websocket/handler')).getSessionsForDraft(session.draftId),
      );
    } catch (err) {
      log.warn({ err }, 'Failed to clean up presence');
    }
  }

  // Release the client (helps GC)
  session.userId = null;
  session.draftId = null;
}

// ============================================================
// AUTHORIZATION
// ============================================================
/**
 * A user can subscribe to a draft if they are:
 *   - the owner, OR
 *   - listed as a collaborator (future feature; currently only owner), OR
 *   - an admin
 */
export async function authorizeDraftAccess(
  userId: string,
  draftId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(draftId)) return false;

  // Cache authorization in Redis (30s) to avoid hitting Mongo on every patch
  const cacheKey = key('authz', userId, draftId);
  const redis = getRedisClient();

  try {
    const cached = await redis.get(cacheKey);
    if (cached === '1') return true;
    if (cached === '0') return false;
  } catch (err) {
    log.warn({ err }, 'Redis authz cache read failed');
  }

  const draft = await DraftModel.findById(draftId).select('ownerId').lean();
  if (!draft) return false;

  const allowed = draft.ownerId.toString() === userId;

  try {
    await redis.set(cacheKey, allowed ? '1' : '0', 'EX', 30);
  } catch {
    // ignore cache write errors
  }

  return allowed;
}

// ============================================================
// SUBSCRIBE
// ============================================================
export interface SubscribeResult {
  version: number;
  snapshot: {
    title: string;
    content: unknown;
    contentType: string;
    metadata: Record<string, unknown>;
    updatedAt: string;
  };
}

/**
 * Load the draft and its current snapshot. If `sinceVersion` is provided
 * and there are ops after it, they will be replayed by the client on top
 * of the snapshot (we return the snapshot as the baseline).
 *
 * We always return the current snapshot, and let the client catch up by
 * replaying ops (the caller may request them via a subsequent `ops` frame
 * in the future). For v1 we keep it simple: always send the full snapshot.
 */
export async function subscribeToDraft(
  session: Session,
  draftId: string,
  _sinceVersion?: number,
): Promise<SubscribeResult> {
  const draft = await DraftModel.findById(draftId).lean();
  if (!draft) {
    throw new Error('Draft not found');
  }

  session.draftId = draftId;
  session.lastKnownVersion = draft.version;

  return {
    version: draft.version,
    snapshot: {
      title: draft.title,
      content: draft.content,
      contentType: draft.contentType,
      metadata: draft.metadata,
      updatedAt: draft.updatedAt.toISOString(),
    },
  };
}

// ============================================================
// VERSION BUMP (called by patch-handler)
// ============================================================
/**
 * Advances the session's known version after a successful patch.
 * Must be called by patch-handler AFTER Mongo commit.
 */
export function bumpVersion(session: Session, newVersion: number): void {
  session.lastKnownVersion = newVersion;
}