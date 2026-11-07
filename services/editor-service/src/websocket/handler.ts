/**
 * WebSocket server — setup, authentication, lifecycle, message routing.
 *
 * Protocol (JSON frames):
 *   Client → Server:
 *     { type: 'auth',      token }
 *     { type: 'subscribe', draftId, sinceVersion? }
 *     { type: 'patch',     baseVersion, ops, clientOpId }
 *     { type: 'ping' }
 *     { type: 'presence',  cursorPosition? }
 *
 *   Server → Client:
 *     { type: 'auth_ok',   userId }
 *     { type: 'subscribed', draftId, version, snapshot }
 *     { type: 'ack',       clientOpId, version, serverTime }
 *     { type: 'nack',      clientOpId, reason, serverVersion }
 *     { type: 'patch',     baseVersion, ops, clientOpId, userId }   // rebroadcast
 *     { type: 'presence',  users: [{userId, cursorPosition, lastSeen}] }
 *     { type: 'error',     code, detail }
 *     { type: 'pong' }
 *
 * Lifecycle per connection:
 *   1. `connection` event → assign UUID, start ping timer
 *   2. Wait for `auth` frame (10s timeout)
 *   3. Wait for `subscribe` frame (10s timeout)
 *   4. Steady state: patches, presence, pings
 *   5. On `close` → cleanup presence, unsubscribe, remove from room
 *
 * Security:
 *   - JWT verified on `auth` frame (not during upgrade — WSS is not guaranteed yet)
 *   - Per-connection rate limit on messages (config.ws.maxMessageRatePerSec)
 *   - Max connections per user enforced (config.ws.maxConnectionsPerUser)
 *   - Max payload size enforced by `ws` itself (config.ws.maxPayloadBytes)
 */

import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { randomUUID } from 'crypto';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { verifyAccessToken } from '@/utils/jwt.util';
import * as sessionModule from './session';
import * as patchHandler from './patch-handler';
import * as presence from './presence';
import { z } from 'zod';

const log = createLogger('websocket.handler');

// ============================================================
// STATE
// ============================================================
let wss: WebSocketServer | null = null;
const connections = new Map<string, sessionModule.Session>();
// user_id → Set<connection_id>
const userConnections = new Map<string, Set<string>>();

// ============================================================
// MESSAGE SCHEMAS (validated before processing)
// ============================================================
const AuthFrame = z.object({
  type: z.literal('auth'),
  token: z.string().min(20).max(4096),
});

const SubscribeFrame = z.object({
  type: z.literal('subscribe'),
  draftId: z.string().uuid(),
  sinceVersion: z.number().int().nonnegative().optional(),
});

const PatchFrame = z.object({
  type: z.literal('patch'),
  baseVersion: z.number().int().nonnegative(),
  ops: z.array(z.unknown()).min(1).max(1000),
  clientOpId: z.string().min(1).max(64),
});

const PingFrame = z.object({ type: z.literal('ping') });

const PresenceFrame = z.object({
  type: z.literal('presence'),
  cursorPosition: z.number().int().nonnegative().optional(),
});

const IncomingFrame = z.discriminatedUnion('type', [
  AuthFrame,
  SubscribeFrame,
  PatchFrame,
  PingFrame,
  PresenceFrame,
]);

// ============================================================
// PUBLIC: ATTACH TO HTTP SERVER
// ============================================================
export function attachWebSocketServer(server: HttpServer): void {
  if (wss) return;

  wss = new WebSocketServer({
    server,
    path: config.ws.path,
    maxPayload: config.ws.maxPayloadBytes,
    perMessageDeflate: {
      // Compress text frames larger than 1 KB — patches can be large.
      threshold: 1024,
      // Zero = default compression level (3)
      zlibDeflateOptions: { level: 3 },
    },
    clientTracking: false, // we track our own sessions
  });

  wss.on('connection', (ws: WebSocket, req) => {
    handleConnection(ws, req.socket.remoteAddress ?? 'unknown');
  });

  wss.on('error', (err) => {
    log.error({ err }, 'WebSocket server error');
  });

  log.info({ path: config.ws.path }, 'WebSocket server attached');
}

// ============================================================
// PUBLIC: GRACEFUL CLOSE
// ============================================================
export async function closeWebSocketServer(): Promise<void> {
  if (!wss) return;

  const server = wss;
  wss = null;

  // Send close frame to every peer
  for (const client of server.clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch {
      // ignore
    }
  }

  // Wait for clients to actually close (max 5 s)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Cleanup sessions
  for (const session of connections.values()) {
    await sessionModule.destroySession(session);
  }
  connections.clear();
  userConnections.clear();

  log.info('WebSocket server closed');
}

// ============================================================
// PUBLIC: ACCESSORS (used by presence + outbox)
// ============================================================
export function getSessionsForDraft(draftId: string): sessionModule.Session[] {
  return Array.from(connections.values()).filter(
    (s) => s.draftId === draftId,
  );
}

export function getSessionsForUser(userId: string): sessionModule.Session[] {
  const ids = userConnections.get(userId);
  if (!ids) return [];
  return Array.from(ids)
    .map((id) => connections.get(id))
    .filter((s): s is sessionModule.Session => s !== undefined);
}

// ============================================================
// CONNECTION HANDLER
// ============================================================
function handleConnection(ws: WebSocket, remoteAddress: string): void {
  const connectionId = randomUUID();
  const session = sessionModule.createSession(ws, connectionId, remoteAddress);
  connections.set(connectionId, session);

  log.info({ connectionId, remoteAddress }, 'Client connected');

  // -------- Ping timer --------
  const pingTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - session.lastPongAt > config.ws.pongTimeoutMs) {
      log.warn(
        { connectionId, sinceLastPongMs: Date.now() - session.lastPongAt },
        'Pong timeout — terminating connection',
      );
      ws.terminate();
      return;
    }
    try {
      ws.ping();
    } catch (err) {
      log.warn({ connectionId, err }, 'Ping failed');
    }
  }, config.ws.pingIntervalMs);
  pingTimer.unref();

  // -------- Message rate-limit (token bucket per connection) --------
  const rateState = { count: 0, windowStart: Date.now() };

  // -------- Frame handler --------
  ws.on('pong', () => {
    session.lastPongAt = Date.now();
  });

  ws.on('message', (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      sendError(session, 'binary_not_allowed', 'Binary frames are not supported');
      return;
    }

    // Rate limit
    const now = Date.now();
    if (now - rateState.windowStart > 1000) {
      rateState.count = 0;
      rateState.windowStart = now;
    }
    rateState.count++;
    if (rateState.count > config.ws.maxMessageRatePerSec) {
      sendError(session, 'rate_limited', 'Message rate exceeded');
      ws.close(1008, 'Rate limited');
      return;
    }

    // Parse + validate
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      sendError(session, 'invalid_json', 'Message is not valid JSON');
      return;
    }

    const parsed = IncomingFrame.safeParse(raw);
    if (!parsed.success) {
      sendError(session, 'invalid_frame', parsed.error.issues[0]?.message ?? 'Invalid frame');
      return;
    }

    const frame = parsed.data;

    // Dispatch
    void dispatchFrame(session, frame).catch((err) => {
      log.error({ err, connectionId, frameType: frame.type }, 'Frame handler error');
      sendError(session, 'internal_error', 'Unexpected error');
    });
  });

  // -------- Close --------
  ws.on('close', (code, reason) => {
    clearInterval(pingTimer);
    connections.delete(connectionId);
    if (session.userId) {
      const set = userConnections.get(session.userId);
      set?.delete(connectionId);
      if (set && set.size === 0) userConnections.delete(session.userId);
    }
    void sessionModule.destroySession(session).catch((err) => {
      log.error({ err, connectionId }, 'Error during session cleanup');
    });
    log.info(
      { connectionId, userId: session.userId, code, reason: reason.toString() },
      'Client disconnected',
    );
  });

  ws.on('error', (err) => {
    log.error({ err, connectionId }, 'WebSocket error');
  });
}

// ============================================================
// FRAME DISPATCH
// ============================================================
async function dispatchFrame(
  session: sessionModule.Session,
  frame: z.infer<typeof IncomingFrame>,
): Promise<void> {
  // ----- Auth (must be first) -----
  if (frame.type === 'auth') {
    if (session.userId) {
      sendError(session, 'already_authenticated', 'Already authenticated');
      return;
    }
    try {
      const payload = verifyAccessToken(frame.token);
      if (payload.type !== 'access') {
        sendError(session, 'invalid_token_type', 'Not an access token');
        return;
      }

      // Enforce max concurrent connections per user
      const existing = userConnections.get(payload.sub) ?? new Set();
      if (existing.size >= config.ws.maxConnectionsPerUser) {
        // Close the oldest connection for this user
        const oldestId = existing.values().next().value;
        if (oldestId) {
          const oldest = connections.get(oldestId);
          if (oldest) {
            oldest.ws.close(1008, 'Too many concurrent connections');
            existing.delete(oldestId);
          }
        }
      }

      session.userId = payload.sub;
      session.role = payload.role;
      session.emailVerified = payload.emailVerified;
      existing.add(session.connectionId);
      userConnections.set(payload.sub, existing);

      sendJson(session, { type: 'auth_ok', userId: payload.sub });
      log.info(
        { connectionId: session.connectionId, userId: payload.sub },
        'WebSocket authenticated',
      );
    } catch {
      sendError(session, 'invalid_token', 'Authentication failed');
      session.ws.close(1008, 'Authentication failed');
    }
    return;
  }

  // All other frames require authentication
  if (!session.userId) {
    sendError(session, 'not_authenticated', 'Send an auth frame first');
    return;
  }

  // ----- Subscribe -----
  if (frame.type === 'subscribe') {
    // Authorize access to the draft (must be owner or collaborator)
    const allowed = await sessionModule.authorizeDraftAccess(
      session.userId,
      frame.draftId,
    );
    if (!allowed) {
      sendError(session, 'forbidden', 'You do not have access to this draft');
      return;
    }

    // Leave previous draft if any
    if (session.draftId) {
      await presence.removeUser(session.draftId, session.userId, session.connectionId);
    }

    const result = await sessionModule.subscribeToDraft(
      session,
      frame.draftId,
      frame.sinceVersion,
    );

    sendJson(session, {
      type: 'subscribed',
      draftId: frame.draftId,
      version: result.version,
      snapshot: result.snapshot,
    });

    // Broadcast presence update
    await presence.addUser(session.draftId, session.userId, session.connectionId, {
      role: session.role ?? 'reader',
    });
    await presence.broadcast(session.draftId, getSessionsForDraft(frame.draftId));
    return;
  }

  // ----- Patch -----
  if (frame.type === 'patch') {
    if (!session.draftId) {
      sendError(session, 'not_subscribed', 'Subscribe to a draft first');
      return;
    }
    await patchHandler.handlePatch(session, {
      baseVersion: frame.baseVersion,
      ops: frame.ops,
      clientOpId: frame.clientOpId,
    });
    return;
  }

  // ----- Presence heartbeat -----
  if (frame.type === 'presence') {
    if (!session.draftId || !session.userId) return;
    await presence.touch(session.draftId, session.userId, session.connectionId);
    return;
  }

  // ----- Ping -----
  if (frame.type === 'ping') {
    sendJson(session, { type: 'pong', serverTime: Date.now() });
    return;
  }
}

// ============================================================
// HELPERS
// ============================================================
export function sendJson(session: sessionModule.Session, payload: unknown): void {
  if (session.ws.readyState !== WebSocket.OPEN) return;
  try {
    session.ws.send(JSON.stringify(payload));
  } catch (err) {
    log.warn({ err, connectionId: session.connectionId }, 'Send failed');
  }
}

export function sendError(
  session: sessionModule.Session,
  code: string,
  detail: string,
): void {
  sendJson(session, { type: 'error', code, detail });
}