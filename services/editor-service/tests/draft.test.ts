/**
 * Integration tests for draft CRUD + authorization + rate limits.
 *
 * These hit the real HTTP layer via supertest against a real Mongo
 * database (see tests/setup.ts).
 */

import request from 'supertest';
import { Types } from 'mongoose';
import { createApp } from '@/app';
import { createTestUser, createTestDraft } from './helpers';
import { DraftModel } from '@/models/Draft.model';

const app = createApp();

// ============================================================
// AUTH GUARD
// ============================================================
describe('Authentication guard', () => {
  it('rejects unauthenticated create', async () => {
    const res = await request(app)
      .post('/api/v1/editor/drafts')
      .send({ contentType: 'article' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated list', async () => {
    const res = await request(app).get('/api/v1/editor/drafts');
    expect(res.status).toBe(401);
  });
});

// ============================================================
// CREATE
// ============================================================
describe('POST /api/v1/editor/drafts', () => {
  it('creates a draft with defaults', async () => {
    const user = await createTestUser();

    const res = await request(app)
      .post('/api/v1/editor/drafts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ contentType: 'article' });

    expect(res.status).toBe(201);
    expect(res.body.draft).toMatchObject({
      title: 'Untitled',
      contentType: 'article',
      status: 'draft',
      version: 0,
      wordCount: 0,
    });
    expect(res.body.draft.id).toMatch(/^[a-f0-9]{24}$/);
  });

  it('rejects invalid contentType', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/editor/drafts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ contentType: 'video' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields (mass assignment)', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/editor/drafts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ contentType: 'article', status: 'published' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// LIST
// ============================================================
describe('GET /api/v1/editor/drafts', () => {
  it('lists only my drafts', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();

    await createTestDraft(alice.id, { title: 'Alice 1' });
    await createTestDraft(alice.id, { title: 'Alice 2' });
    await createTestDraft(bob.id, { title: 'Bob 1' });

    const res = await request(app)
      .get('/api/v1/editor/drafts')
      .set('Authorization', `Bearer ${alice.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((d: { title: string }) => d.title).sort()).toEqual([
      'Alice 1',
      'Alice 2',
    ]);
  });

  it('paginates with cursor', async () => {
    const user = await createTestUser();
    for (let i = 1; i <= 5; i++) {
      await createTestDraft(user.id, { title: `Draft ${i}` });
    }

    const first = await request(app)
      .get('/api/v1/editor/drafts?limit=2')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next_cursor).toBeTruthy();

    const second = await request(app)
      .get(`/api/v1/editor/drafts?limit=2&cursor=${first.body.next_cursor}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(second.body.data).toHaveLength(2);

    // No overlap between pages
    const firstIds = first.body.data.map((d: { id: string }) => d.id);
    const secondIds = second.body.data.map((d: { id: string }) => d.id);
    for (const id of secondIds) expect(firstIds).not.toContain(id);
  });

  it('rejects limit > 100', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/api/v1/editor/drafts?limit=500')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(400);
  });
});

// ============================================================
// GET ONE
// ============================================================
describe('GET /api/v1/editor/drafts/:id', () => {
  it('returns my draft', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, { title: 'Hello' });
    const res = await request(app)
      .get(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.draft.title).toBe('Hello');
  });

  it('forbids access to another user\'s draft', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const draft = await createTestDraft(alice.id);
    const res = await request(app)
      .get(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent draft', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get(`/api/v1/editor/drafts/${new Types.ObjectId().toString()}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects an invalid ObjectId', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/api/v1/editor/drafts/not-an-object-id')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(400);
  });
});

// ============================================================
// UPDATE
// ============================================================
describe('PATCH /api/v1/editor/drafts/:id', () => {
  it('updates metadata', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id, { title: 'Old' });

    const res = await request(app)
      .patch(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ title: 'New Title', language: 'ar-EG' });

    expect(res.status).toBe(200);
    expect(res.body.draft.title).toBe('New Title');
    expect(res.body.draft.language).toBe('ar-EG');
  });

  it('rejects empty body', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id);
    const res = await request(app)
      .patch(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('honors If-Match for optimistic concurrency', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id);

    // Bump version via direct DB write to simulate a concurrent edit
    await DraftModel.updateOne(
      { _id: new Types.ObjectId(draft.id) },
      { $inc: { version: 1 } },
    );

    // Stale If-Match → 409
    const res = await request(app)
      .patch(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('If-Match', '"1"')
      .send({ title: 'Stale' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERSION_MISMATCH');
  });
});

// ============================================================
// DELETE
// ============================================================
describe('DELETE /api/v1/editor/drafts/:id', () => {
  it('soft-deletes and hides from list', async () => {
    const user = await createTestUser();
    const draft = await createTestDraft(user.id);

    const del = await request(app)
      .delete(`/api/v1/editor/drafts/${draft.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get('/api/v1/editor/drafts')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(list.body.data).toHaveLength(0);
  });
});