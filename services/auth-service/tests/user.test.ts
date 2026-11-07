/**
 * User profile + account management tests.
 */

import request from 'supertest';
import { createApp } from '@/app';
import { query } from '@/db/postgres';
import { createTestUser, countRefreshTokens } from './helpers';

const app = createApp();

// ============================================================
// GET /users/me
// ============================================================
describe('GET /api/v1/users/me', () => {
  it('returns the current user', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.password_hash).toBeUndefined();
  });

  it('rejects unauthenticated', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });
});

// ============================================================
// PATCH /users/me
// ============================================================
describe('PATCH /api/v1/users/me', () => {
  it('updates allowed fields', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        displayName: 'Updated Name',
        bio: 'I write books.',
        language: 'en-US',
      });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Updated Name');
    expect(res.body.user.bio).toBe('I write books.');
  });

  it('rejects invalid avatar URL', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ avatarUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields (mass assignment guard)', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
describe('POST /api/v1/users/me/change-password', () => {
  it('changes the password and revokes other sessions', async () => {
    const user = await createTestUser();
    const before = await countRefreshTokens(user.id);
    expect(before).toBeGreaterThanOrEqual(1);

    const res = await request(app)
      .post('/api/v1/users/me/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: user.password, newPassword: 'BrandNew1' });

    expect(res.status).toBe(200);
    expect(await countRefreshTokens(user.id)).toBe(0);

    // New password works
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'BrandNew1' });
    expect(login.status).toBe(200);
  });

  it('rejects wrong current password', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/users/me/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'WrongPass1', newPassword: 'BrandNew1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('WRONG_PASSWORD');
  });

  it('rejects same password', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post('/api/v1/users/me/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: user.password, newPassword: user.password });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SAME_PASSWORD');
  });
});

// ============================================================
// DELETE /users/me
// ============================================================
describe('DELETE /api/v1/users/me', () => {
  it('requires the confirm phrase', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ password: user.password, confirmPhrase: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('requires the correct password', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ password: 'WrongPass1', confirmPhrase: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(401);
  });

  it('soft-deletes the user and revokes sessions', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ password: user.password, confirmPhrase: 'DELETE MY ACCOUNT' });
    expect(res.status).toBe(202);

    const { rows } = await query<{ deleted_at: Date | null }>(
      'SELECT deleted_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
    expect(await countRefreshTokens(user.id)).toBe(0);

    // Cannot log in again
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(401);
  });
});

// ============================================================
// GET /users/:id  (public profile)
// ============================================================
describe('GET /api/v1/users/:id', () => {
  it('returns public fields only', async () => {
    const user = await createTestUser({ displayName: 'Public Name' });
    const res = await request(app).get(`/api/v1/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Public Name');
    // No email, role, or verification status
    expect(res.body.user.email).toBeUndefined();
    expect(res.body.user.role).toBeUndefined();
    expect(res.body.user.emailVerified).toBeUndefined();
  });

  it('returns 404 for unknown user', async () => {
    const res = await request(app).get(
      '/api/v1/users/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});