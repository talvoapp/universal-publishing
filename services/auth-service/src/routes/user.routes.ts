/**
 * OAuth 2.0 routes (Google & GitHub).
 *
 * Flow:
 *   GET /api/v1/oauth/google                → redirect to Google consent screen
 *   GET /api/v1/oauth/google/callback       → Google redirects here; we issue tokens and 302 to frontend
 *
 * Same for GitHub.
 *
 * Implementation notes:
 *   - Passport strategies are registered in `services/oauth.service.ts`
 *     (imported for side effects at the top of this file).
 *   - On success, the OAuth callback redirects the browser to
 *     `${FRONTEND_URL}/auth/callback?accessToken=…&refreshToken=…`
 *     The frontend then stores tokens and calls `/api/v1/users/me`.
 *   - On failure, redirect to `${FRONTEND_URL}/auth/error?code=…`.
 *   - State parameter is validated by Passport automatically.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import '@/services/oauth.service'; // register strategies (side effect)

const log = createLogger('oauth.routes');
const router = Router();

// ============================================================
// HELPERS
// ============================================================
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

function redirectSuccess(res: Response, accessToken: string, refreshToken: string): void {
  const url = new URL('/auth/callback', FRONTEND_URL);
  url.searchParams.set('accessToken', accessToken);
  url.searchParams.set('refreshToken', refreshToken);
  res.redirect(302, url.toString());
}

function redirectError(res: Response, code: string): void {
  const url = new URL('/auth/error', FRONTEND_URL);
  url.searchParams.set('code', code);
  res.redirect(302, url.toString());
}

// ============================================================
// GOOGLE
// ============================================================
if (config.oauth.google) {
  router.get(
    '/google',
    passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      prompt: 'select_account',
    }),
  );

  router.get(
    '/google/callback',
    (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(
        'google',
        { session: false, failureRedirect: `${FRONTEND_URL}/auth/error?code=oauth_failed` },
        (err: Error | null, user: { accessToken: string; refreshToken: string } | false) => {
          if (err) {
            log.error({ err }, 'Google OAuth error');
            return redirectError(res, 'oauth_error');
          }
          if (!user) return redirectError(res, 'oauth_failed');
          return redirectSuccess(res, user.accessToken, user.refreshToken);
        },
      )(req, res, next);
    },
  );
} else {
  router.get('/google', (_req, res) => {
    res.status(503).json({
      type: 'https://httpstatuses.io/503',
      title: 'Google OAuth not configured',
      status: 503,
    });
  });
}

// ============================================================
// GITHUB
// ============================================================
if (config.oauth.github) {
  router.get(
    '/github',
    passport.authenticate('github', {
      scope: ['user:email'],
      session: false,
    }),
  );

  router.get(
    '/github/callback',
    (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(
        'github',
        { session: false, failureRedirect: `${FRONTEND_URL}/auth/error?code=oauth_failed` },
        (err: Error | null, user: { accessToken: string; refreshToken: string } | false) => {
          if (err) {
            log.error({ err }, 'GitHub OAuth error');
            return redirectError(res, 'oauth_error');
          }
          if (!user) return redirectError(res, 'oauth_failed');
          return redirectSuccess(res, user.accessToken, user.refreshToken);
        },
      )(req, res, next);
    },
  );
} else {
  router.get('/github', (_req, res) => {
    res.status(503).json({
      type: 'https://httpstatuses.io/503',
      title: 'GitHub OAuth not configured',
      status: 503,
    });
  });
}

export default router;