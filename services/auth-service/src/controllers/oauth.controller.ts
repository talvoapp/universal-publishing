/**
 * OAuth controller — thin orchestration layer.
 *
 * Design:
 *   - The actual authentication logic lives in Passport strategies
 *     (`services/oauth.service.ts`), invoked via `passport.authenticate`.
 *   - This controller only handles:
 *       1. Redirecting the user to the provider's consent screen.
 *       2. Processing the provider's callback (success or failure).
 *       3. Redirecting to the frontend with tokens or an error code.
 *
 * Why a controller at all?
 *   - Consistent with auth.controller.ts / user.controller.ts pattern.
 *   - Easier to test (mock `passport` module, no HTTP round-trip needed).
 *   - Keeps `oauth.routes.ts` declarative and boring.
 */

import type { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import type { AuthResult } from '@/services/oauth.service';

const log = createLogger('oauth.controller');

// ============================================================
// CONSTANTS
// ============================================================
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';

// ============================================================
// REDIRECT HELPERS
// ============================================================
function redirectSuccess(res: Response, tokens: AuthResult): void {
  const url = new URL('/auth/callback', FRONTEND_URL);
  url.searchParams.set('accessToken', tokens.accessToken);
  url.searchParams.set('refreshToken', tokens.refreshToken);
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
/**
 * GET /api/v1/oauth/google
 * Redirects the browser to Google's consent screen.
 */
export function googleAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.oauth.google) {
    res.status(503).json({
      type: 'https://httpstatuses.io/503',
      title: 'Google OAuth not configured',
      status: 503,
      instance: req.id,
    });
    return;
  }

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
    prompt: 'select_account',
  })(req, res, next);
}

/**
 * GET /api/v1/oauth/google/callback
 * Google redirects here. On success → frontend with tokens.
 * On failure → frontend with error code.
 */
export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  if (!config.oauth.google) {
    redirectError(res, 'provider_not_configured');
    return;
  }

  passport.authenticate(
    'google',
    { session: false, failureRedirect: `${FRONTEND_URL}/auth/error?code=oauth_failed` },
    (err: Error | null, tokens: AuthResult | false) => {
      if (err) {
        log.error({ err }, 'Google OAuth callback error');
        return redirectError(res, 'oauth_error');
      }
      if (!tokens) return redirectError(res, 'oauth_failed');
      return redirectSuccess(res, tokens);
    },
  )(req, res, next);
}

// ============================================================
// GITHUB
// ============================================================
/**
 * GET /api/v1/oauth/github
 */
export function githubAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.oauth.github) {
    res.status(503).json({
      type: 'https://httpstatuses.io/503',
      title: 'GitHub OAuth not configured',
      status: 503,
      instance: req.id,
    });
    return;
  }

  passport.authenticate('github', {
    scope: ['user:email'],
    session: false,
  })(req, res, next);
}

/**
 * GET /api/v1/oauth/github/callback
 */
export function githubCallback(req: Request, res: Response, next: NextFunction): void {
  if (!config.oauth.github) {
    redirectError(res, 'provider_not_configured');
    return;
  }

  passport.authenticate(
    'github',
    { session: false, failureRedirect: `${FRONTEND_URL}/auth/error?code=oauth_failed` },
    (err: Error | null, tokens: AuthResult | false) => {
      if (err) {
        log.error({ err }, 'GitHub OAuth callback error');
        return redirectError(res, 'oauth_error');
      }
      if (!tokens) return redirectError(res, 'oauth_failed');
      return redirectSuccess(res, tokens);
    },
  )(req, res, next);
}