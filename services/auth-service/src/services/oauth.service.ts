/**
 * OAuth service — Passport strategies for Google & GitHub.
 *
 * Strategy goals:
 *   - Find or create a local user by email
 *   - Link the OAuth provider identity to the account
 *   - Issue our standard JWT pair (access + refresh)
 *
 * Accounts are unique by email, so a user who registered with a
 * password can later sign in with Google using the same email
 * (auto-linking is intentional for UX; email verification by Google
 * is implicit).
 */

import passport from 'passport';
import {
  Strategy as GoogleStrategy,
  type Profile as GoogleProfile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import {
  Strategy as GitHubStrategy,
  type Profile as GitHubProfile,
} from 'passport-github2';

import { config } from '@/config';
import { withTransaction } from '@/db/postgres';
import * as UserModel from '@/models/User.model';
import * as AuditLogModel from '@/models/AuditLog.model';
import * as RefreshTokenModel from '@/models/RefreshToken.model';
import { signAccessToken, signRefreshToken } from '@/utils/jwt.util';
import { createHash, randomBytes } from 'crypto';
import { createLogger } from '@/utils/logger';

const log = createLogger('oauth.service');

// ============================================================
// HELPERS
// ============================================================
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function issueTokensFor(user: UserModel.UserRecord): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
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

  await RefreshTokenModel.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdByIp: 'oauth',
    createdByUserAgent: 'oauth',
  });

  return { accessToken, refreshToken };
}

/**
 * Find-or-create a user from an OAuth profile.
 * The caller must have already verified that `email` is present.
 */
async function findOrCreateOAuthUser(input: {
  email: string;
  displayName: string;
  avatarUrl: string | null;
  provider: 'google' | 'github';
  providerId: string;
}): Promise<UserModel.UserRecord> {
  const existing = await UserModel.findByEmail(input.email);
  if (existing) {
    return existing;
  }

  return withTransaction(async (client) => {
    const created = await UserModel.create(client, {
      email: input.email,
      // Random 64-byte password; OAuth users can't log in with password
      // until they explicitly set one.
      passwordHash: randomBytes(64).toString('hex'),
      displayName: input.displayName,
      role: 'reader',
      emailVerified: true, // OAuth provider has verified the email
      avatarUrl: input.avatarUrl,
    });

    await AuditLogModel.recordWithClient(client, {
      userId: created.id,
      action: `oauth_register:${input.provider}`,
      ip: null,
      requestId: 'oauth',
      metadata: { providerId: input.providerId },
    });

    return created;
  });
}

// ============================================================
// GOOGLE
// ============================================================
if (config.oauth.google) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.oauth.google.clientId,
        clientSecret: config.oauth.google.clientSecret,
        callbackURL: config.oauth.google.callbackUrl,
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: GoogleProfile,
        done: VerifyCallback,
      ) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('Google profile has no email'), false);
          }
          const avatar = profile.photos?.[0]?.value ?? null;
          const user = await findOrCreateOAuthUser({
            email,
            displayName: profile.displayName || email.split('@')[0]!,
            avatarUrl: avatar,
            provider: 'google',
            providerId: profile.id,
          });
          const tokens = await issueTokensFor(user);
          return done(null, tokens);
        } catch (err) {
          log.error({ err }, 'Google strategy error');
          return done(err as Error, false);
        }
      },
    ),
  );
}

// ============================================================
// GITHUB
// ============================================================
if (config.oauth.github) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: config.oauth.github.clientId,
        clientSecret: config.oauth.github.clientSecret,
        callbackURL: config.oauth.github.callbackUrl,
        scope: ['user:email'],
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: GitHubProfile,
        done: (err: Error | null, user?: unknown) => void,
      ) => {
        try {
          const email =
            profile.emails?.find((e) => e.primary)?.value ??
            profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('GitHub profile has no verified email'), false);
          }
          const avatar = profile.photos?.[0]?.value ?? null;
          const user = await findOrCreateOAuthUser({
            email,
            displayName: profile.displayName || profile.username || email.split('@')[0]!,
            avatarUrl: avatar,
            provider: 'github',
            providerId: profile.id,
          });
          const tokens = await issueTokensFor(user);
          return done(null, tokens);
        } catch (err) {
          log.error({ err }, 'GitHub strategy error');
          return done(err as Error, false);
        }
      },
    ),
  );
}

// Export nothing else — importing this module is enough (side effects).
export {};