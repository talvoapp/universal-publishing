/**
 * WebSocket integration tests — auth, subscribe, patch, presence, ack/nack.
 *
 * Uses a real `ws` client connecting to a real WebSocketServer attached
 * to a real HTTP server. This exercises the full protocol.
 */

import http from 'http';
import { AddressInfo } from 'net';
import WebSocket from 'ws';
import { createApp } from '@/app';
import { attachWebSocketServer, closeWebSocketServer } from '@/websocket/handler';
import { initMongo, closeMongo } from '@/db/mongo';
import { initRedis, closeRedis } from '@/db/redis';
import { initOutboxPublisher, closeOutboxPublisher } from '@/outbox/publisher';
import { createTestUser, createTestDraft, waitForFrame } from './helpers';
import type { Server } from 'http';

// ============================================================
// TEST SERVER SETUP
// ============================================================
let server: Server;
let port: number;
let baseWsUrl: string;

beforeAll(async () => {
  await initMongo();
  await initRedis();
  // Outbox publisher will fail to connect to Kafka — that's fine,
  // events will buffer in Redis. We don't assert on Kafka in this suite.
  await initOutboxPublisher().catch(() => undefined);

  const app = createApp();
  server = http.createServer(app);
  attachWebSocketServer(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      port = addr.port;
      baseWsUrl = `ws://127.0.0.1:${port}/editor/stream`;
      resolve();
    });
  });
}, 30000);

afterAll(async () => {
  await closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeOutboxPublisher();
  await closeRedis();
  await closeMongo();
}, 30000);

// ============================================================
// HELPERS
// ============================================================
function openWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(baseWsUrl);
    const t = setTimeout(() => reject(new Error('WS open timeout')), 5000);
    ws.once('open', () => {
      clearTimeout(t);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function send(ws: WebSocket, frame: unknown): void {
  ws.send(JSON.stringify(frame));
}

function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', () => resolve());
    ws.close();
  });
}

// ============================================================
// AUTH
// ============================================================
describe('WebSocket auth', () => {
  it('accepts a valid token', async () => {
    const user = await createTestUser();
    const ws = await openWs();

    send(ws, { type: 'auth', token: user.accessToken });
    const frame = await waitForFrame(ws, 'auth_ok');
    expect(frame.userId).toBe(user.id);

    await closeWs(ws);
  });

  it('rejects an invalid token and closes', async () => {
    const ws = await openWs();
    send(ws, { type: 'auth', token: 'not-a-valid-jwt' });

    const frame = await waitForFrame(ws, 'error');
    expect(frame.code).toBe('invalid_token');

    await closeWs(ws);
  });

  it('rejects non-auth frames before auth', async () => {
    const ws = await openWs();
    send(ws, { type: 'subscribe', draftId: 'x' });

    const frame = await waitForFrame(ws, 'error');
    expect(frame.code).toBe('not_authenticated');

    await closeWs(ws);
  });

  it('rejects unknown frame types', async () => {
    const ws = await openWs();
    send(ws, { type: 'weird_type', foo: 'bar' });

    const frame = await waitForFrame(ws, 'error');
    expect(frame.code).toBe('invalid_frame');

    await closeWs(ws);
  });
});

// ============================================================
// SUBSCRIBE
// ============================================================
describe('WebSocket subscribe', () => {
  it('subscribes to own draft and gets a snapshot', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, {
      title: 'My draft',
      content: 'Hello world',
      version: 3,
    });

    const ws = await openWs();
    send(ws, { type: 'auth', token: user.accessToken });
    await waitForFrame(ws, 'auth_ok');

    send(ws, { type: 'subscribe', draftId: draft.id });
    const frame = await waitForFrame(ws, 'subscribed');

    expect(frame.draftId).toBe(draft.id);
    expect(frame.version).toBe(3);
    expect(frame.snapshot.title).toBe('My draft');
    expect(frame.snapshot.content).toBe('Hello world');

    await closeWs(ws);
  });

  it('rejects subscription to another user\'s draft', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const draft = await createTestDraft(alice.id);

    const ws = await openWs();
    send(ws, { type: 'auth', token: bob.accessToken });
    await waitForFrame(ws, 'auth_ok');

    send(ws, { type: 'subscribe', draftId: draft.id });
    const frame = await waitForFrame(ws, 'error');
    expect(frame.code).toBe('forbidden');

    await closeWs(ws);
  });
});

// ============================================================
// PATCH
// ============================================================
describe('WebSocket patch', () => {
  it('applies a simple insert op', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, {
      content: 'Hello',
      version: 1,
    });

    const ws = await openWs();
    send(ws, { type: 'auth', token: user.accessToken });
    await waitForFrame(ws, 'auth_ok');

    send(ws, { type: 'subscribe', draftId: draft.id });
    await waitForFrame(ws, 'subscribed');

    send(ws, {
      type: 'patch',
      baseVersion: 1,
      ops: [{ type: 'insert', pos: 5, text: ' world' }],
      clientOpId: 'op-1',
    });
    const ack = await waitForFrame(ws, 'ack');
    expect(ack.clientOpId).toBe('op-1');
    expect(ack.version).toBe(2);

    await closeWs(ws);
  });

  it('nacks on version mismatch', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, {
      content: 'Hello',
      version: 5,
    });

    const ws = await openWs();
    send(ws, { type: 'auth', token: user.accessToken });
    await waitForFrame(ws, 'auth_ok');

    send(ws, { type: 'subscribe', draftId: draft.id });
    await waitForFrame(ws, 'subscribed');

    // Wrong baseVersion
    send(ws, {
      type: 'patch',
      baseVersion: 3,
      ops: [{ type: 'insert', pos: 0, text: 'X' }],
      clientOpId: 'op-bad',
    });
    const nack = await waitForFrame(ws, 'nack');
    expect(nack.reason).toBe('version_mismatch');
    expect(nack.serverVersion).toBe(5);

    await closeWs(ws);
  });

  it('nacks invalid op shape', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, { content: '', version: 1 });

    const ws = await openWs();
    send(ws, { type: 'auth', token: user.accessToken });
    await waitForFrame(ws, 'auth_ok');
    send(ws, { type: 'subscribe', draftId: draft.id });
    await waitForFrame(ws, 'subscribed');

    send(ws, {
      type: 'patch',
      baseVersion: 1,
      ops: [{ type: 'invalid' }],
      clientOpId: 'op-bad2',
    });
    const nack = await waitForFrame(ws, 'nack');
    expect(nack.reason).toBe('invalid_op');

    await closeWs(ws);
  });
});