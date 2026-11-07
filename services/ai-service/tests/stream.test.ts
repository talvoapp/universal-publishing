/**
 * SSE streaming integration tests — resume, abort, error paths, shutdown.
 *
 * These are the trickiest tests in ai-service because they need to:
 *   - Open a real SSE stream
 *   - Simulate mid-stream disconnects and resumes
 *   - Trigger the graceful-shutdown path
 *
 * We mock the provider SDKs, so these tests do not hit the network.
 * Everything else (SSE frames, session store, quota, fallback) runs
 * for real against a test Redis.
 */

import request from 'supertest';
import { createApp } from '@/app';
import { createTestUser, parseSSE, framesOfType, concatenateChunks } from './helpers';
import { closeAllStreams } from '@/sse/stream.handler';
import { getRedisClient, sseSessionKey } from '@/db/redis';
import { config } from '@/config';

// ------------------------------------------------------------
// MOCKS — one controllable stub per provider
// ------------------------------------------------------------
const openaiStreamMock = jest.fn();
const anthropicStreamMock = jest.fn();

jest.mock('@/services/openai.service', () => ({
  stream: (...args: unknown[]) => openaiStreamMock(...args),
}));
jest.mock('@/services/anthropic.service', () => ({
  stream: (...args: unknown[]) => anthropicStreamMock(...args),
}));

const app = createApp();

beforeEach(() => {
  openaiStreamMock.mockReset();
  anthropicStreamMock.mockReset();
});

// ============================================================
// HAPPY PATH
// ============================================================
describe('SSE streaming — happy path', () => {
  it('emits chunk/usage/done and persists the session in Redis', async () => {
    // Provider stub: emits 3 chunks then completes
    openaiStreamMock.mockImplementationOnce(async (opts: {
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'foo' });
      await opts.onChunk({ delta: ' bar' });
      await opts.onChunk({ delta: ' baz' });
      return { tokensIn: 10, tokensOut: 3, finishReason: 'stop', model: 'gpt-4o' };
    });

    const user = createTestUser({ role: 'author' });
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    expect(res.status).toBe(200);

    const frames = parseSSE(res.text);
    expect(concatenateChunks(frames)).toBe('foo bar baz');

    const dones = framesOfType(frames, 'done') as Array<{ session_id: string }>;
    expect(dones).toHaveLength(1);
    expect(dones[0]!.session_id).toMatch(/^[0-9a-f-]{36}$/);

    const usages = framesOfType(frames, 'usage') as Array<{ tokens_in: number; tokens_out: number }>;
    expect(usages).toHaveLength(1);
    expect(usages[0]!.tokens_in).toBe(10);
    expect(usages[0]!.tokens_out).toBe(3);

    // Session persisted with status completed
    const raw = await getRedisClient().get(sseSessionKey(dones[0]!.session_id));
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw!);
    expect(session.status).toBe('completed');
    expect(session.accumulated).toBe('foo bar baz');
  });
});

// ============================================================
// RESUME: completed session → idempotent replay
// ============================================================
describe('SSE streaming — resume after completion', () => {
  it('replays the exact accumulated text without calling the provider again', async () => {
    openaiStreamMock.mockImplementationOnce(async (opts: {
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'Hello world' });
      return { tokensIn: 5, tokensOut: 2, finishReason: 'stop', model: 'gpt-4o' };
    });

    const user = createTestUser({ role: 'author' });

    // First call: normal stream
    const first = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'hi' } });
    const firstFrames = parseSSE(first.text);
    const sessionId = (framesOfType(firstFrames, 'done') as Array<{ session_id: string }>)[0]!.session_id;

    expect(openaiStreamMock).toHaveBeenCalledTimes(1);

    // Second call with the same sessionId: must NOT call the provider
    const second = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        operation: 'grammar',
        selection: { text: 'hi' },
        sessionId,
      });

    expect(second.status).toBe(200);
    expect(openaiStreamMock).toHaveBeenCalledTimes(1); // still 1

    const secondFrames = parseSSE(second.text);
    expect(concatenateChunks(secondFrames)).toBe('Hello world');
    const dones = framesOfType(secondFrames, 'done') as Array<{ finish_reason: string }>;
    expect(dones[0]!.finish_reason).toBe('replay');
  });
});

// ============================================================
// RESUME: session owned by a different user → treated as NONE
// ============================================================
describe('SSE streaming — ownership', () => {
  it('rejects resume from a different user (falls back to fresh session)', async () => {
    // Create session A
    openaiStreamMock.mockImplementationOnce(async (opts: {
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'private text' });
      return { tokensIn: 5, tokensOut: 2, finishReason: 'stop', model: 'gpt-4o' };
    });
    const userA = createTestUser({ role: 'author' });
    const first = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'hi' } });
    const sessionId = (framesOfType(parseSSE(first.text), 'done') as Array<{ session_id: string }>)[0]!.session_id;

    // User B tries to resume A's session
    openaiStreamMock.mockImplementationOnce(async (opts: {
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'fresh text' });
      return { tokensIn: 3, tokensOut: 1, finishReason: 'stop', model: 'gpt-4o' };
    });
    const userB = createTestUser({ role: 'author' });
    const second = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({
        operation: 'grammar',
        selection: { text: 'hi' },
        sessionId,
      });

    expect(second.status).toBe(200);
    // A fresh provider call was made (the old session was NOT replayed)
    expect(openaiStreamMock).toHaveBeenCalledTimes(2);
    expect(concatenateChunks(parseSSE(second.text))).toBe('fresh text');
  });
});

// ============================================================
// FALLBACK
// ============================================================
describe('SSE streaming — provider fallback', () => {
  it('falls back to the secondary provider on ProviderUnavailableError', async () => {
    const { ProviderUnavailableError } = await import('@/utils/errors');

    openaiStreamMock.mockRejectedValueOnce(
      new ProviderUnavailableError('openai down', 'OPENAI_FAILED'),
    );
    anthropicStreamMock.mockImplementationOnce(async (opts: {
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'fallback answer' });
      return { tokensIn: 8, tokensOut: 2, finishReason: 'end_turn', model: 'claude' };
    });

    const user = createTestUser({ role: 'author' });
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    expect(res.status).toBe(200);
    expect(concatenateChunks(parseSSE(res.text))).toBe('fallback answer');
    expect(anthropicStreamMock).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// ERROR PATHS
// ============================================================
describe('SSE streaming — errors', () => {
  it('emits a retryable error frame when both providers fail', async () => {
    const { ProviderUnavailableError } = await import('@/utils/errors');

    openaiStreamMock.mockRejectedValueOnce(new ProviderUnavailableError('down', 'OPENAI_FAILED'));
    anthropicStreamMock.mockRejectedValueOnce(new ProviderUnavailableError('down', 'ANTHROPIC_FAILED'));

    const user = createTestUser({ role: 'author' });
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    // SSE already started (200), error arrives as an event
    expect(res.status).toBe(200);
    const frames = parseSSE(res.text);
    const errors = framesOfType(frames, 'error') as Array<{ code: string; retryable: boolean }>;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.retryable).toBe(true);
  });

  it('rejects with 429 when the quota is exhausted (before streaming)', async () => {
    const user = createTestUser({ role: 'reader' });
    const ymd = new Date().toISOString().slice(0, 10);
    const { quotaKey } = await import('@/db/redis');
    await getRedisClient().set(
      quotaKey(user.id, ymd),
      String(config.quotas.tiers.free),
      'EX',
      3600,
    );

    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
  });
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
describe('SSE streaming — graceful shutdown', () => {
  it('closeAllStreams emits a retryable error frame and ends the stream', async () => {
    // Provider stub that blocks until we resolve it manually
    let releaseProvider: (() => void) | null = null;
    openaiStreamMock.mockImplementationOnce(async (opts: {
      signal: AbortSignal;
      onChunk: (c: { delta: string }) => Promise<void> | void;
    }) => {
      await opts.onChunk({ delta: 'first chunk' });
      // Wait until the stream handler aborts us via closeAllStreams
      await new Promise<void>((resolve) => {
        releaseProvider = resolve;
        opts.signal.addEventListener('abort', () => resolve(), { once: true });
        // Hard safety net
        setTimeout(resolve, 5000);
      });
      return { tokensIn: 1, tokensOut: 1, finishReason: 'stop', model: 'gpt-4o' };
    });

    const user = createTestUser({ role: 'author' });

    // Start the stream — we don't await it directly since we need to
    // call closeAllStreams while it's in flight.
    const pending = request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    // Give the stream a moment to start and emit its first chunk
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Trigger graceful shutdown
    await closeAllStreams('server_shutting_down');

    // The provider function is still blocking — release it so the promise resolves
    if (releaseProvider) releaseProvider();

    const res = await pending;
    expect(res.status).toBe(200);

    const frames = parseSSE(res.text);
    const errors = framesOfType(frames, 'error') as Array<{ code: string; retryable: boolean }>;
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.code).toBe('server_shutting_down');
    expect(errors[0]!.retryable).toBe(true);
  }, 10000);
});