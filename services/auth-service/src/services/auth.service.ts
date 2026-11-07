/**
 * Authentication service — the heart of the auth domain.
 *
 * Responsibilities:
 *   - Registration (with transaction + email verification token)
 *   - Login (with constant-time email/password check, generic errors)
 *   - Refresh token rotation (with reuse detection → family revocation)
 *   - Logout (single session + all sessions)
 *   - Password reset flow
 *   - Email verification flow
 *
 * Design notes:
 *   - Business logic only; no HTTP concepts.
 *   - All DB writes that span multiple rows are wrapped in transactions.
 *   - Refresh tokens are stored hashed (SHA-256), never plaintext.
 *   - "Family" tracking: each refresh token belongs to a chain. If a
 *     previously-rotated token is reused (likely theft), the entire
 *     family is revoked.
 */

import { createHash, randomBytes } from 'crypto';
import { withTransaction } from '@/db/postgres';
import { getRedisClient } from '@/db/redis';
import * as UserModel from '@/models/User.model';
import * as RefreshTokenModel from '@/models/RefreshToken.model';
import * as AuditLogModel from '@/models/AuditLog.model';
import { hashPassword, verifyPassword } from '@/utils/password.util';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@/utils/jwt.util';
import { sendVerificationEmail, sendPasswordResetEmail } from '@/services/email.service';
import {
  ConflictError,
  UnauthorizedError,
  BadRequestError,
  NotFoundError,
} from '@/utils/errors';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';

const log = createLogger('auth.service');

// ============================================================
// TYPES
// ============================================================
interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  requestId: string;
  ip: string;
}

interface LoginInput {
  email: string;
  password: string;
  requestId: string;
  ip: string;
  userAgent: string;
}

interface RefreshInput {
  refreshToken: string;
  requestId: string;
  ip: string;
  userAgent: string;
}

interface LogoutInput {
  refreshToken: string;
  requestId: string;
}

interface LogoutAllInput {
  userId: string;
  requestId: string;
}

interface ForgotPasswordInput {
  email: string;
  requestId: string;
}

interface ResetPasswordInput {
  token: string;
  newPassword: string;
  requestId: string;
}

interface VerifyEmailInput {
  token: string;
  requestId: string;
}

interface ResendVerificationInput {
  userId: string;
  requestId: string;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: 'reader' | 'author' | 'editor' | 'admin';
  emailVerified: boolean;
  avatarUrl: string | null;
  createdAt: string;
}

// ============================================================
// HELPERS
// ============================================================
function toPublicUser(u: UserModel.UserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    emailVerified: u.email_verified,
    avatarUrl: u.avatar_url,
    createdAt: u.created_at.toISOString(),
  };
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Constant-time-ish comparison to avoid timing side channels in
 * the "user not found" login case. We hash both the user input and
 * a fixed dummy string, so the response time is similar whether the
 * email exists or not. bcrypt's own verify() is constant-time.
 */
const DUMMY_HASH =
  '$2b$12$K2qXKqXKqXKqXKqXKqXKqOeKqXKqXKqXKqXKqXKqXKqXKqXKqXKqXK';

// ============================================================
// REGISTER
// ============================================================
export async function register(input: RegisterInput): Promise<AuthResult> {
  const { email, password, displayName, requestId, ip } = input;

  // ----- Pre-check (also enforced by unique index) -----
  const existing = await UserModel.findByEmail(email);
  if (existing) {
    // Still count in audit for security monitoring
    await AuditLogModel.record({
      userId: null,
      action: 'register_conflict',
      ip,
      requestId,
      metadata: { email },
    });
    throw new ConflictError('Email is already registered', 'EMAIL_EXISTS');
  }

  // ----- Hash password -----
  const passwordHash = await hashPassword(password);

  // ----- Email verification token (expires 24h) -----
  const verificationToken = randomBytes(32).toString('hex');
  const verificationHash = sha256(verificationToken);
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // ----- Transaction: create user + audit -----
  const user = await withTransaction(async (client) => {
    const created = await UserModel.create(client, {
      email,
      passwordHash,
      displayName,
      role: 'reader',
      emailVerified: false,
      verificationTokenHash: verificationHash,
      verificationTokenExpiresAt: verificationExpiresAt,
    });

    await AuditLogModel.recordWithClient(client, {
      userId: created.id,
      action: 'register_success',
      ip,
      requestId,
      metadata: { email },
    });

    return created;
  });

  // ----- Tokens -----
  const tokens = await issueTokenPair(user, { requestId, ip, userAgent: 'unknown' });

  // ----- Send email (fire-and-forget; do not fail registration) -----
  void sendVerificationEmail({
    to: user.email,
    displayName: user.display_name,
    token: verificationToken,
  }).catch((err) => log.error({ err, userId: user.id }, 'Failed to send verification email'));

  return {
    user: toPublicUser(user),
    ...tokens,
  };
}

// ============================================================
// LOGIN
// ============================================================
export async function login(input: LoginInput): Promise<AuthResult> {
  const { email, password, requestId, ip, userAgent } = input;

  const user = await UserModel.findByEmail(email);

  // ----- Constant-time: always call verify() -----
  const storedHash = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, storedHash);

  if (!user || !passwordOk) {
    await AuditLogModel.record({
      userId: user?.id ?? null,
      action: 'login_failed',
      ip,
      requestId,
      metadata: { email, reason: user ? 'bad_password' : 'no_user' },
    });
    // Generic error message — never reveal which part was wrong.
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  // ----- Optional: require verified email for login? No — but flag it. -----
  // The app can still show "please verify" UI; login is not blocked here.

  // ----- Issue tokens -----
  const tokens = await issueTokenPair(user, { requestId, ip, userAgent });

  await AuditLogModel.record({
    userId: user.id,
    action: 'login_success',
    ip,
    requestId,
    metadata: { userAgent },
  });

  return {
    user: toPublicUser(user),
    ...tokens,
  };
}

// ============================================================
// REFRESH — ROTATION + REUSE DETECTION
// ============================================================
export async function refresh(input: RefreshInput): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const { refreshToken, requestId, ip, userAgent } = input;

  // ----- Verify JWT signature + expiry -----
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new UnauthorizedError('Invalid refresh token', 'INVALID_REFRESH');
  }
  if (payload.type !== 'refresh') {
    throw new UnauthorizedError('Token type mismatch', 'INVALID_REFRESH');
  }

  const tokenHash = sha256(refreshToken);

  // ----- Look up the row (must be unused) -----
  const stored = await RefreshTokenModel.findByHash(tokenHash);

  // ----- REUSE DETECTION -----
  if (!stored || stored.revoked_at) {
    // Token was already used or never existed. If it was previously
    // revoked as part of a rotation, that's a strong signal of theft.
    if (stored?.revoked_at) {
      log.warn(
        { userId: stored.user_id, familyId: stored.family_id },
        'Refresh token reuse detected — revoking family',
      );
      await RefreshTokenModel.revokeFamily(stored.family_id);
      await AuditLogModel.record({
        userId: stored.user_id,
        action: 'refresh_reuse_detected',
        ip,
        requestId,
        metadata: { familyId: stored.family_id },
      });
    }
    throw new UnauthorizedError('Refresh token has been revoked', 'REFRESH_REVOKED');
  }

  // ----- Expiry check (JWT already checks, but validate DB row too) -----
  if (stored.expires_at.getTime() < Date.now()) {
    throw new UnauthorizedError('Refresh token expired', 'REFRESH_EXPIRED');
  }

  // ----- Load the user -----
  const user = await UserModel.findById(stored.user_id);
  if (!user) {
    throw new UnauthorizedError('User no longer exists', 'USER_GONE');
  }

  // ----- ROTATE: revoke old, issue new (same family) -----
  const newRefreshToken = signRefreshToken({
    sub: user.id,
    type: 'refresh',
    familyId: stored.family_id,
    jti: randomBytes(16).toString('hex'),
  });
  const newRefreshHash = sha256(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await RefreshTokenModel.rotate({
    oldHash: tokenHash,
    newHash: newRefreshHash,
    userId: user.id,
    familyId: stored.family_id,
    expiresAt: newExpiresAt,
    replacedByIp: ip,
    replacedByUserAgent: userAgent,
  });

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.email_verified,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn: 15 * 60,
  };
}

// ============================================================
// LOGOUT (single session)
// ============================================================
export async function logout(input: LogoutInput): Promise<void> {
  const { refreshToken, requestId } = input;
  const tokenHash = sha256(refreshToken);

  const stored = await RefreshTokenModel.findByHash(tokenHash);
  if (!stored || stored.revoked_at) {
    // Idempotent — logout is always safe to call.
    return;
  }

  await RefreshTokenModel.revoke(tokenHash, 'user_logout');

  await AuditLogModel.record({
    userId: stored.user_id,
    action: 'logout',
    ip: null,
    requestId,
    metadata: {},
  });
}

// ============================================================
// LOGOUT ALL
// ============================================================
export async function logoutAll(input: LogoutAllInput): Promise<void> {
  const { userId, requestId } = input;
  await RefreshTokenModel.revokeAllForUser(userId, 'user_logout_all');
  await AuditLogModel.record({
    userId,
    action: 'logout_all',
    ip: null,
    requestId,
    metadata: {},
  });
}

// ============================================================
// FORGOT PASSWORD
// ============================================================
export async function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  const { email, requestId } = input;

  const user = await UserModel.findByEmail(email);
  if (!user) {
    // Silent — do not reveal whether the email exists.
    log.info({ requestId }, 'forgot-password: no such user (silent)');
    return;
  }

  // ----- Rate-limit per email: 3 per hour (Redis counter) -----
  const redis = getRedisClient();
  const key = `${config.redis.keyPrefix}pwreset:${user.id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  if (count > 3) {
    log.warn({ userId: user.id }, 'forgot-password: rate limit exceeded (silent)');
    return; // silent — do not reveal the limit either
  }

  // ----- Generate one-time reset token (expires 1h) -----
  const resetToken = randomBytes(32).toString('hex');
  const resetHash = sha256(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await UserModel.setPasswordResetToken(user.id, resetHash, expiresAt);

  void sendPasswordResetEmail({
    to: user.email,
    displayName: user.display_name,
    token: resetToken,
  }).catch((err) => log.error({ err, userId: user.id }, 'Failed to send reset email'));

  await AuditLogModel.record({
    userId: user.id,
    action: 'password_reset_requested',
    ip: null,
    requestId,
    metadata: {},
  });
}

// ============================================================
// RESET PASSWORD
// ============================================================
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const { token, newPassword, requestId } = input;

  const tokenHash = sha256(token);
  const user = await UserModel.findByPasswordResetToken(tokenHash);

  if (!user || !user.password_reset_expires_at) {
    throw new BadRequestError('Invalid or expired reset token', 'INVALID_RESET_TOKEN');
  }
  if (user.password_reset_expires_at.getTime() < Date.now()) {
    throw new BadRequestError('Reset token has expired', 'RESET_TOKEN_EXPIRED');
  }

  const newHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await UserModel.updatePasswordWithClient(client, user.id, newHash);
    await UserModel.clearPasswordResetTokenWithClient(client, user.id);
    await RefreshTokenModel.revokeAllForUserWithClient(client, user.id, 'password_reset');
    await AuditLogModel.recordWithClient(client, {
      userId: user.id,
      action: 'password_reset_completed',
      ip: null,
      requestId,
      metadata: {},
    });
  });
}

// ============================================================
// VERIFY EMAIL
// ============================================================
export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const { token, requestId } = input;

  const tokenHash = sha256(token);
  const user = await UserModel.findByVerificationToken(tokenHash);

  if (!user || !user.verification_token_expires_at) {
    throw new BadRequestError('Invalid verification token', 'INVALID_VERIFICATION_TOKEN');
  }
  if (user.verification_token_expires_at.getTime() < Date.now()) {
    throw new BadRequestError('Verification token has expired', 'VERIFICATION_TOKEN_EXPIRED');
  }
  if (user.email_verified) {
    return; // idempotent
  }

  await withTransaction(async (client) => {
    await UserModel.markEmailVerifiedWithClient(client, user.id);
    await AuditLogModel.recordWithClient(client, {
      userId: user.id,
      action: 'email_verified',
      ip: null,
      requestId,
      metadata: {},
    });
  });
}

// ============================================================
// RESEND VERIFICATION
// ============================================================
export async function resendVerification(input: ResendVerificationInput): Promise<void> {
  const { userId, requestId } = input;

  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  if (user.email_verified) {
    throw new BadRequestError('Email is already verified', 'ALREADY_VERIFIED');
  }

  // Rate-limit: 3 per hour per user
  const redis = getRedisClient();
  const key = `${config.redis.keyPrefix}resend_verify:${user.id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 3600);
  if (count > 3) {
    throw new BadRequestError('Too many attempts. Try again later.', 'RESEND_RATE_LIMITED');
  }

  const verificationToken = randomBytes(32).toString('hex');
  const verificationHash = sha256(verificationToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await UserModel.setVerificationToken(user.id, verificationHash, expiresAt);

  void sendVerificationEmail({
    to: user.email,
    displayName: user.display_name,
    token: verificationToken,
  }).catch((err) => log.error({ err, userId: user.id }, 'Failed to resend verification'));

  await AuditLogModel.record({
    userId: user.id,
    action: 'verification_resent',
    ip: null,
    requestId,
    metadata: {},
  });
}

// ============================================================
// ISSUE TOKEN PAIR (helper)
// ============================================================
async function issueTokenPair(
  user: UserModel.UserRecord,
  ctx: { requestId: string; ip: string; userAgent: string },
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const familyId = randomBytes(16).toString('hex');
  const jti = randomBytes(16).toString('hex');

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.email_verified,
  });

  const refreshToken = signRefreshToken({
    sub: user.id,
    type: 'refresh',
    familyId,
    jti,
  });

  const refreshHash = sha256(refreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await RefreshTokenModel.create({
    userId: user.id,
    tokenHash: refreshHash,
    familyId,
    expiresAt,
    createdByIp: ctx.ip,
    createdByUserAgent: ctx.userAgent,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,
  };
}