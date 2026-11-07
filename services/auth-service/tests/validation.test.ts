/**
 * Pure unit tests for the Zod schemas — no HTTP, no DB.
 * These guard the input contract independently of the routes.
 */

import {
  registerSchema,
  loginSchema,
  refreshSchema,
  resetPasswordSchema,
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from '@/types/index';

describe('registerSchema', () => {
  it('accepts a valid payload', () => {
    const r = registerSchema.safeParse({
      email: 'A@Example.com',
      password: 'StrongPass1',
      displayName: 'Alice',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('a@example.com'); // lowercased
    }
  });

  it.each([
    ['short password', { email: 'a@b.com', password: 'short', displayName: 'X' }],
    ['no digit', { email: 'a@b.com', password: 'NoDigitHere', displayName: 'X' }],
    ['no letter', { email: 'a@b.com', password: '12345678', displayName: 'X' }],
    ['bad email', { email: 'not-email', password: 'StrongPass1', displayName: 'X' }],
    ['blank displayName', { email: 'a@b.com', password: 'StrongPass1', displayName: '  ' }],
    ['extra field', { email: 'a@b.com', password: 'StrongPass1', displayName: 'X', role: 'admin' }],
  ])('rejects %s', (_label, payload) => {
    const r = registerSchema.safeParse(payload);
    expect(r.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts a valid payload with any password (no policy enforced)', () => {
    // Login accepts legacy passwords — the policy isn't applied here.
    const r = loginSchema.safeParse({ email: 'a@b.com', password: 'x' });
    expect(r.success).toBe(true);
  });

  it('rejects empty password', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: '' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const r = loginSchema.safeParse({
      email: 'a@b.com',
      password: 'x',
      rememberMe: true,
    });
    expect(r.success).toBe(false);
  });
});

describe('refreshSchema', () => {
  it('accepts a plausible token', () => {
    const r = refreshSchema.safeParse({ refreshToken: 'a'.repeat(200) });
    expect(r.success).toBe(true);
  });

  it('rejects very short strings', () => {
    const r = refreshSchema.safeParse({ refreshToken: 'abc' });
    expect(r.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts valid input', () => {
    const r = resetPasswordSchema.safeParse({
      token: 'a'.repeat(64),
      newPassword: 'BrandNew1',
    });
    expect(r.success).toBe(true);
  });

  it('applies the password policy', () => {
    const r = resetPasswordSchema.safeParse({
      token: 'a'.repeat(64),
      newPassword: 'weak',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts all valid optional fields', () => {
    const r = updateProfileSchema.safeParse({
      displayName: 'X',
      bio: 'hello',
      avatarUrl: 'https://cdn.example.com/a.png',
      language: 'en-US',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid language code', () => {
    const r = updateProfileSchema.safeParse({ language: 'english' });
    expect(r.success).toBe(false);
  });

  it('rejects bio > 500 chars', () => {
    const r = updateProfileSchema.safeParse({ bio: 'a'.repeat(501) });
    expect(r.success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('requires a new password that meets policy', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'OldPass1',
      newPassword: 'weak',
    });
    expect(r.success).toBe(false);
  });
});

describe('deleteAccountSchema', () => {
  it('requires the exact confirm phrase', () => {
    const ok = deleteAccountSchema.safeParse({
      password: 'x',
      confirmPhrase: 'DELETE MY ACCOUNT',
    });
    expect(ok.success).toBe(true);

    const bad = deleteAccountSchema.safeParse({
      password: 'x',
      confirmPhrase: 'delete my account',
    });
    expect(bad.success).toBe(false);
  });
});