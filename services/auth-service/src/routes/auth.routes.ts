/**
 * Authentication routes.
 *
 * All endpoints under /api/v1/auth/*.
 *
 * Middleware chain per route:
 *   [limiter] → [validator] → [controller]
 *
 * Rate limits are tighter than the global limiter:
 *   - register/login: 5 attempts per 15 min per IP (brute-force defense)
 *   - refresh:        30 req/min (legit clients refresh often)
 *   - forgot/reset:   3 attempts per hour per IP (email abuse defense)
 *   - others:         standard auth limiter
 */

import { Router } from 'express';
import * as authController from '@/controllers/auth.controller';
import { validateBody } from '@/middleware/validation.middleware';
import {
  authRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
  passwordResetRateLimiter,
  refreshRateLimiter,
} from '@/middleware/rate-limit.middleware';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from '@/types/index';

const router = Router();

// ============================================================
// REGISTRATION
// ============================================================
/**
 * POST /api/v1/auth/register
 * Body: { email, password, displayName }
 * Response 201: { user, accessToken, refreshToken }
 */
router.post(
  '/register',
  registerRateLimiter,
  validateBody(registerSchema),
  authController.register,
);

// ============================================================
// LOGIN
// ============================================================
/**
 * POST /api/v1/auth/login
 * Body: { email, password }
 * Response 200: { user, accessToken, refreshToken }
 */
router.post(
  '/login',
  loginRateLimiter,
  validateBody(loginSchema),
  authController.login,
);

// ============================================================
// TOKEN REFRESH
// ============================================================
/**
 * POST /api/v1/auth/refresh
 * Body: { refreshToken }
 * Response 200: { accessToken, refreshToken }
 * (Old refresh token is rotated — reuse detection revokes the whole family)
 */
router.post(
  '/refresh',
  refreshRateLimiter,
  validateBody(refreshSchema),
  authController.refresh,
);

// ============================================================
// LOGOUT (single session)
// ============================================================
/**
 * POST /api/v1/auth/logout
 * Body: { refreshToken }
 * Response 204: (no content)
 */
router.post(
  '/logout',
  authRateLimiter,
  validateBody(logoutSchema),
  authController.logout,
);

// ============================================================
// LOGOUT ALL SESSIONS
// ============================================================
/**
 * POST /api/v1/auth/logout-all
 * Requires: Authorization header (access token)
 * Response 204: (no content)
 * Revokes all refresh tokens for the current user.
 */
router.post('/logout-all', authRateLimiter, authController.logoutAll);

// ============================================================
// FORGOT PASSWORD
// ============================================================
/**
 * POST /api/v1/auth/forgot-password
 * Body: { email }
 * Response 202: { message } — always "if an account exists…" (no enumeration)
 */
router.post(
  '/forgot-password',
  passwordResetRateLimiter,
  validateBody(forgotPasswordSchema),
  authController.forgotPassword,
);

// ============================================================
// RESET PASSWORD
// ============================================================
/**
 * POST /api/v1/auth/reset-password
 * Body: { token, newPassword }
 * Response 200: { message }
 * Revokes all sessions after password reset.
 */
router.post(
  '/reset-password',
  passwordResetRateLimiter,
  validateBody(resetPasswordSchema),
  authController.resetPassword,
);

// ============================================================
// EMAIL VERIFICATION
// ============================================================
/**
 * POST /api/v1/auth/verify-email
 * Body: { token }
 * Response 200: { message }
 */
router.post(
  '/verify-email',
  authRateLimiter,
  validateBody(verifyEmailSchema),
  authController.verifyEmail,
);

/**
 * POST /api/v1/auth/resend-verification
 * Requires: Authorization header (access token)
 * Response 202: { message }
 */
router.post(
  '/resend-verification',
  passwordResetRateLimiter,
  validateBody(resendVerificationSchema),
  authController.resendVerification,
);

export default router;