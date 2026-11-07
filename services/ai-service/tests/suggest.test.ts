/**
 * `/ai/suggest` endpoint integration tests.
 *
 * We mock the provider SDK (openai + anthropic) to avoid real network
 * calls. Everything else (SSE, quota, session store, fallback
 * orchestration) runs for real against a test Redis.
 */

import request from 'supertest';
import { createApp } from '@/app';
import { createTestUser } from './helpers';
import { parseSSE, framesOfType, concatenateChunks } from './helpers';
import { getRedisClient, quotaKey } from '@/db/redis';
import { config } from '@/config';

// ------------------------------------------------------------
// MOCK PROVIDERS
// ------------------------------------------------------------
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async (_opts: unknown, ctx: { signal: AbortSignal }) => {
          // Return a fake async iterable of chunks
          return (async function* () {
            for (const delta of ['Hello', ' ', 'world', '!']) {
              if (ctx.signal.aborted) throw new Error('AbortError');
              yield { choices: [{ delta: { content: delta } }] };
            }
            yield {
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            };
          })();
        }),
      },
    },
  }));
});

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockImplementation(async () => {
        return (async function* () {
          yield { type: 'message_start', message: { usage: { input_tokens: 100 } } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Fallback' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' works' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } };
        })();
      }),
    },
  }));
});

const app = createApp();

// ============================================================
// AUTH
// ============================================================
describe('POST /api/v1/ai/suggest — auth', () => {
  it('rejects unauthenticated', async () => {
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .send({
        operation: 'grammar',
        selection: { text: 'teh cat' },
      });
    expect(res.status).toBe(401);
  });
});

// ============================================================
// VALIDATION
// ============================================================
describe('POST /api/v1/ai/suggest — validation', () => {
  it('rejects missing operation', async () => {
    const user = createTestUser();
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ selection: { text: 'x' } });
    expect(res.status).toBe(400);
  });

  it('rejects missing selection body', async () => {
    const user = createTestUser();
    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// HAPPY PATH (SSE)
// ============================================================
describe('POST /api/v1/ai/suggest — happy path', () => {
  it('streams chunks and a done event', async () => {
    const user = createTestUser({ role: 'author' }); // premium

    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({
        operation: 'grammar',
        selection: { text: 'teh cat sat' },
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['x-ai-quota-limit']).toBeDefined();

    const frames = parseSSE(res.text);
    const chunks = framesOfType(frames, 'chunk') as { delta: string }[];
    const fullText = concatenateChunks(frames);

    expect(fullText.length).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(0);

    const done = framesOfType(frames, 'done') as { session_id: string; finish_reason: string }[];
    expect(done.length).toBe(1);
    expect(done[0]!.finish_reason).toBe('stop');
    expect(done[0]!.session_id).toMatch(/^[0-9a-f-]{36}$/);

    const usage = framesOfType(frames, 'usage') as { tokens_in: number; tokens_out: number }[];
    expect(usage.length).toBe(1);
    expect(usage[0]!.tokens_in).toBe(100);
    expect(usage[0]!.tokens_out).toBe(20);
  });
});

// ============================================================
// QUOTA ENFORCEMENT
// ============================================================
describe('POST /api/v1/ai/suggest — quota', () => {
  it('returns 429 when quota is already exhausted', async () => {
    const user = createTestUser({ role: 'reader' }); // free: 5,000

    // Fill the counter
    const ymd = new Date().toISOString().slice(0, 10);
    const redis = getRedisClient();
    await redis.set(quotaKey(user.id, ymd), String(config.quotas.tiers.free), 'EX', 3600);

    const res = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'test' } });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.quota).toBeDefined();
    expect(res.body.quota.limit).toBe(config.quotas.tiers.free);
  });
});

// ============================================================
// SESSION
// ============================================================
describe('POST /api/v1/ai/suggest — session', () => {
  it('replays a completed session (idempotent)', async () => {
    const user = createTestUser({ role: 'author' });

    // First call — full stream
    const first = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ operation: 'grammar', selection: { text: 'hello' } });
    expect(first.status).toBe(200);
    const firstFrames = parseSSE(first.text);
    const done = framesOfType(firstFrames, 'done') as { session_id: string }[];
    const sessionId = done[0]!.session_id;

    // Second call with the same sessionId — should replay
    const second = await request(app)
      .post('/api/v1/ai/suggest')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        operation: 'grammar',
        selection: { text: 'hello' },
        sessionId,
      });
    expect(second.status).toBe(200);
    const secondFrames = parseSSE(second.text);
    const secondDone = framesOfType(secondFrames, 'done') as { finish_reason: string }[];
    expect(secondDone[0]!.finish_reason).toBe('replay');
  });
});

// ============================================================
// FEEDBACK
// ============================================================
describe('POST /api/v1/ai/feedback', () => {
  it('accepts valid feedback', async () => {
    const user = createTestUser();
    const res = await request(app)
      .post('/api/v1/ai/feedback')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        sessionId: '00000000-0000-4000-8000-000000000000',
        rating: 5,
        comment: 'Great!',
      });
    expect(res.status).toBe(202);
  });

  it('rejects rating out of range', async () => {
    const user = createTestUser();
    const res = await request(app)
      .post('/api/v1/ai/feedback')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        sessionId: '00000000-0000-4000-8000-000000000000',
        rating: 9,
      });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// QUOTA STATUS
// ============================================================
describe('GET /api/v1/quota', () => {
  it('returns quota status for the current user', async () => {
    const user = createTestUser({ role: 'author' });
    const res = await request(app)
      .get('/api/v1/quota')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('premium');
    expect(res.body.limit).toBe(config.quotas.tiers.premium);
    expect(res.body.used).toBe(0);
  });
});