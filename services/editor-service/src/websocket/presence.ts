/**
 * Presence tracking — who's currently editing this draft?
 *
 * Storage: Redis Set per draft, keyed `presence:{draftId}`, members
 * are serialized `{userId}:{connectionId}` strings.
 *
 * Each entry has a TTL set via a companion key `presence_ttl:{...}`.
 * Rather than sweeping expired members (expensive), we store the
 * last-seen timestamp inside the member itself and filter on read.
 *
 * Read path:
 *   SMEMBERS → parse each → filter out stale (>presenceTtlMs) → dedupe by userId
 *
 * Write path:
 *   SADD + SETEX TTL key
 *
 * Broadcast:
 *   Send `presence` frame to every subscribed session
 */

import { getRedisClient, key } from '@/db/redis';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { sendJson } from './handler';
import type { Session } from './session';

const log = createLogger('websocket.presence');

// ============================================================
// TYPES
// ============================================================
export interface PresenceEntry {
  userId: string;
  connectionId: string;
  role: string;
  cursorPosition: number | null;
  lastSeen: number; // epoch ms
}

interface SerializedMember {
  u: string; // userId
  c: string; // connectionId
  r: string; // role
  p: number | null; // cursor position
  t: number; // lastSeen (epoch ms)
}

// ============================================================
// KEY
// ============================================================
function setKey(draftId: string): string {
  return key('presence', draftId);
}

// ============================================================
// SERIALIZE / DESERIALIZE
// ============================================================
function serialize(entry: PresenceEntry): string {
  const s: SerializedMember = {
    u: entry.userId,
    c: entry.connectionId,
    r: entry.role,
    p: entry.cursorPosition,
    t: entry.lastSeen,
  };
  return JSON.stringify(s);
}

function deserialize(raw: string): PresenceEntry | null {
  try {
    const s = JSON.parse(raw) as Partial<SerializedMember>;
    if (!s.u || !s.c || typeof s.t !== 'number') return null;
    return {
      userId: s.u,
      connectionId: s.c,
      role: s.r ?? 'reader',
      cursorPosition: s.p ?? null,
      lastSeen: s.t,
    };
  } catch {
    return null;
  }
}

// ============================================================
// ADD
// ============================================================
export async function addUser(
  draftId: string,
  userId: string,
  connectionId: string,
  opts: { role: string; cursorPosition?: number } = { role: 'reader' },
): Promise<void> {
  const redis = getRedisClient();
  const sk = setKey(draftId);

  const entry: PresenceEntry = {
    userId,
    connectionId,
    role: opts.role,
    cursorPosition: opts.cursorPosition ?? null,
    lastSeen: Date.now(),
  };

  try {
    await redis.sadd(sk, serialize(entry));
    // Set a TTL on the whole set — if it expires it's because nobody
    // has written in a while; safe to rebuild.
    await redis.expire(sk, Math.ceil(config.editor.presenceTtlMs / 1000) * 2);
  } catch (err) {
    log.warn({ err, draftId, userId }, 'Failed to add presence');
  }
}

// ============================================================
// TOUCH
// ============================================================
/**
 * Refresh the lastSeen timestamp for an existing member.
 * We remove-then-add because Redis SET members are immutable.
 */
export async function touch(
  draftId: string,
  userId: string,
  connectionId: string,
): Promise<void> {
  const redis = getRedisClient();
  const sk = setKey(draftId);

  try {
    const members = await redis.smembers(sk);
    for (const raw of members) {
      const e = deserialize(raw);
      if (e && e.userId === userId && e.connectionId === connectionId) {
        await redis.srem(sk, raw);
        await redis.sadd(sk, serialize({ ...e, lastSeen: Date.now() }));
        return;
      }
    }
  } catch (err) {
    log.warn({ err, draftId, userId }, 'Failed to touch presence');
  }
}

// ============================================================
// REMOVE
// ============================================================
export async function removeUser(
  draftId: string,
  userId: string,
  connectionId: string,
): Promise<void> {
  const redis = getRedisClient();
  const sk = setKey(draftId);

  try {
    const members = await redis.smembers(sk);
    for (const raw of members) {
      const e = deserialize(raw);
      if (e && e.userId === userId && e.connectionId === connectionId) {
        await redis.srem(sk, raw);
      }
    }
  } catch (err) {
    log.warn({ err, draftId, userId }, 'Failed to remove presence');
  }
}

// ============================================================
// LIST
// ============================================================
/**
 * Return active presence entries (deduped by userId, keeping the most
 * recent connection). Filters out entries older than presenceTtlMs.
 */
export async function listUsers(draftId: string): Promise<PresenceEntry[]> {
  const redis = getRedisClient();
  const sk = setKey(draftId);
  const cutoff = Date.now() - config.editor.presenceTtlMs;

  let members: string[] = [];
  try {
    members = await redis.smembers(sk);
  } catch (err) {
    log.warn({ err, draftId }, 'Failed to list presence');
    return [];
  }

  const byUser = new Map<string, PresenceEntry>();
  for (const raw of members) {
    const e = deserialize(raw);
    if (!e || e.lastSeen < cutoff) continue;
    const existing = byUser.get(e.userId);
    if (!existing || e.lastSeen > existing.lastSeen) {
      byUser.set(e.userId, e);
    }
  }
  return Array.from(byUser.values());
}

// ============================================================
// BROADCAST
// ============================================================
/**
 * Send a `presence` frame to every subscribed session.
 * Called after add/remove/touch.
 */
export async function broadcast(
  draftId: string,
  sessions: Session[],
): Promise<void> {
  if (sessions.length === 0) return;

  const users = await listUsers(draftId);
  const frame = {
    type: 'presence',
    users: users.map((u) => ({
      userId: u.userId,
      cursorPosition: u.cursorPosition,
      lastSeen: new Date(u.lastSeen).toISOString(),
    })),
  };

  for (const s of sessions) {
    sendJson(s, frame);
  }
}