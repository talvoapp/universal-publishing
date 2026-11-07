/**
 * RBAC tests — verify role hierarchy, guards, and HTTP-layer enforcement.
 */

import request from 'supertest';
import { createApp } from '@/app';
import { createTestUser } from './helpers';
import { signAccessToken } from '@/utils/jwt.util';

const app = createApp();

// ============================================================
// HIERARCHY (pure function)
// ============================================================
import { hasRoleLevel, requireRole, requireMinRole, requireVerifiedEmail, requireSelfOrAdmin } from '@/middleware/rbac.middleware';
import type { Request, Response, NextFunction } from 'express';

describe('hasRoleLevel', () => {
  it.each([
    ['reader', 'reader', true],
    ['author', 'reader', true],
    ['editor', 'author', true],
    ['admin', 'editor', true],
    ['reader', 'admin', false],
    ['author', 'editor', false],
  ] as const)('%s vs %s → %s', (actual, required, expected) => {
    expect(hasRoleLevel(actual, required)).toBe(expected);
  });
});

// ============================================================
// GUARDS (unit style — mock req/res/next)
// ============================================================
function mockReq(user: { id: string; role: 'reader' | 'author' | 'editor' | 'admin'; emailVerified?: boolean } | null): Request {
  return {
    user: user
      ? { id: user.id, email: user.role as never, role: user.role, emailVerified: user.emailVerified ?? true }
      : undefined,
    params: {},
  } as unknown as Request;
}

const mockRes = {} as Response;
const mockNext = jest.fn() as unknown as NextFunction;

describe('requireRole', () => {
  beforeEach(() => (mockNext as jest.Mock).mockClear());

  it('allows when role matches', () => {
    const mw = requireRole('admin', 'editor');
    expect(() => mw(mockReq({ id: 'x', role: 'editor' }), mockRes, mockNext)).not.toThrow();
    expect(mockNext).toHaveBeenCalled();
  });

  it('forbids when role does not match', () => {
    const mw = requireRole('admin');
    expect(() => mw(mockReq({ id: 'x', role: 'reader' }), mockRes, mockNext)).toThrow(/admin/);
  });

  it('forbids anonymous', () => {
    const mw = requireRole('reader');
    expect(() => mw(mockReq(null), mockRes, mockNext)).toThrow();
  });
});

describe('requireMinRole', () => {
  it('grants equal or higher', () => {
    const mw = requireMinRole('editor');
    expect(() => mw(mockReq({ id: 'x', role: 'admin' }), mockRes, mockNext)).not.toThrow();
  });

  it('denies lower', () => {
    const mw = requireMinRole('editor');
    expect(() => mw(mockReq({ id: 'x', role: 'author' }), mockRes, mockNext)).toThrow();
  });
});

describe('requireVerifiedEmail', () => {
  it('passes when verified', () => {
    expect(() =>
      requireVerifiedEmail(mockReq({ id: 'x', role: 'reader', emailVerified: true }), mockRes, mockNext),
    ).not.toThrow();
  });

  it('forbids when not verified', () => {
    expect(() =>
      requireVerifiedEmail(mockReq({ id: 'x', role: 'reader', emailVerified: false }), mockRes, mockNext),
    ).toThrow(/verification/i);
  });
});

describe('requireSelfOrAdmin', () => {
  it('allows self', () => {
    const req = mockReq({ id: 'user-1', role: 'reader' });
    req.params = { id: 'user-1' };
    expect(() => requireSelfOrAdmin()(req, mockRes, mockNext)).not.toThrow();
  });

  it('allows admin on any target', () => {
    const req = mockReq({ id: 'admin-1', role: 'admin' });
    req.params = { id: 'user-2' };
    expect(() => requireSelfOrAdmin()(req, mockRes, mockNext)).not.toThrow();
  });

  it('forbids other user', () => {
    const req = mockReq({ id: 'user-1', role: 'reader' });
    req.params = { id: 'user-2' };
    expect(() => requireSelfOrAdmin()(req, mockRes, mockNext)).toThrow();
  });
});

// ============================================================
// END-TO-END: token with elevated role can access protected route
// ============================================================
describe('HTTP: /users/me accepts tokens of any role', () => {
  it.each(['reader', 'author', 'editor', 'admin'] as const)(
    'accepts %s',
    async (role) => {
      const user = await createTestUser({ role });
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${user.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe(role);
    },
  );
});

describe('HTTP: forged tokens are rejected', () => {
  it('rejects token signed with wrong secret', async () => {
    const forged = signAccessToken({
      sub: '00000000-0000-0000-0000-000000000000',
      email: 'forged@example.com',
      role: 'admin',
      emailVerified: true,
    });
    // Tamper: flip the last character of the signature
    const tampered = forged.slice(0, -3) + 'AAA';

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('rejects refresh token used as access token', async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.refreshToken}`);
    expect(res.status).toBe(401);
  });
});