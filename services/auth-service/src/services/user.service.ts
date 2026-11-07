/**
 * User profile service.
 *
 * Handles read/update of the current user, password change, and
 * account deletion (GDPR/CCPA right to be forgotten).
 */

import * as UserModel from '@/models/User.model';
import * as RefreshTokenModel from '@/models/RefreshToken.model';
import * as AuditLogModel from '@/models/AuditLog.model';
import { withTransaction } from '@/db/postgres';
import { hashPassword, verifyPassword } from '@/utils/password.util';
import {
  NotFoundError,
  UnauthorizedError,
  BadRequestError,
  ConflictError,
} from '@/utils/errors';
import { createLogger } from '@/utils/logger';

const log = createLogger('user.service');

// ============================================================
// TYPES
// ============================================================
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  language: string;
  role: 'reader' | 'author' | 'editor' | 'admin';
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUserProfile {
  id: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  role: 'reader' | 'author' | 'editor' | 'admin';
  createdAt: string;
}

// ============================================================
// HELPERS
// ============================================================
function toProfile(u: UserModel.UserRecord): UserProfile {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    language: u.language,
    role: u.role,
    emailVerified: u.email_verified,
    createdAt: u.created_at.toISOString(),
    updatedAt: u.updated_at.toISOString(),
  };
}

function toPublicProfile(u: UserModel.UserRecord): PublicUserProfile {
  return {
    id: u.id,
    displayName: u.display_name,
    bio: u.bio,
    avatarUrl: u.avatar_url,
    role: u.role,
    createdAt: u.created_at.toISOString(),
  };
}

// ============================================================
// GET ME
// ============================================================
export async function getMe(userId: string): Promise<UserProfile> {
  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  return toProfile(user);
}

// ============================================================
// UPDATE ME
// ============================================================
export async function updateMe(
  userId: string,
  updates: {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    language?: string;
  },
): Promise<UserProfile> {
  const user = await UserModel.update(userId, {
    display_name: updates.displayName,
    bio: updates.bio,
    avatar_url: updates.avatarUrl,
    language: updates.language,
  });
  return toProfile(user);
}

// ============================================================
// CHANGE PASSWORD
// ============================================================
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  requestId: string;
}): Promise<void> {
  const { userId, currentPassword, newPassword, requestId } = input;

  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    await AuditLogModel.record({
      userId,
      action: 'password_change_failed',
      ip: null,
      requestId,
      metadata: { reason: 'wrong_current_password' },
    });
    throw new UnauthorizedError('Current password is incorrect', 'WRONG_PASSWORD');
  }

  if (currentPassword === newPassword) {
    throw new BadRequestError(
      'New password must be different from the current one',
      'SAME_PASSWORD',
    );
  }

  const newHash = await hashPassword(newPassword);

  await withTransaction(async (client) => {
    await UserModel.updatePasswordWithClient(client, userId, newHash);
    // Revoke all refresh tokens except the current session — simplest:
    // revoke all, force re-login everywhere.
    await RefreshTokenModel.revokeAllForUserWithClient(client, userId, 'password_change');
    await AuditLogModel.recordWithClient(client, {
      userId,
      action: 'password_changed',
      ip: null,
      requestId,
      metadata: {},
    });
  });

  log.info({ userId }, 'Password changed');
}

// ============================================================
// SCHEDULE ACCOUNT DELETION
// ============================================================
export async function scheduleDeletion(input: {
  userId: string;
  password: string;
  confirmPhrase: string;
  requestId: string;
}): Promise<void> {
  const { userId, password, confirmPhrase, requestId } = input;

  if (confirmPhrase !== 'DELETE MY ACCOUNT') {
    throw new BadRequestError(
      'Confirmation phrase does not match',
      'INVALID_CONFIRM_PHRASE',
    );
  }

  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await AuditLogModel.record({
      userId,
      action: 'deletion_failed',
      ip: null,
      requestId,
      metadata: { reason: 'wrong_password' },
    });
    throw new UnauthorizedError('Password is incorrect', 'WRONG_PASSWORD');
  }

  // Soft delete + schedule (30-day grace period before hard purge)
  await withTransaction(async (client) => {
    await UserModel.scheduleHardDeleteWithClient(client, userId);
    await RefreshTokenModel.revokeAllForUserWithClient(client, userId, 'account_deletion');
    await AuditLogModel.recordWithClient(client, {
      userId,
      action: 'deletion_scheduled',
      ip: null,
      requestId,
      metadata: {},
    });
  });

  log.warn({ userId }, 'Account scheduled for deletion');
}

// ============================================================
// GET PUBLIC PROFILE
// ============================================================
export async function getPublicProfile(userId: string): Promise<PublicUserProfile> {
  const user = await UserModel.findById(userId);
  if (!user || user.deleted_at) {
    throw new NotFoundError('User not found');
  }
  return toPublicProfile(user);
}