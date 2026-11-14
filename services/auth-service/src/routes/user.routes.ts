/**
 * User profile routes.
 *
 * All endpoints under /api/v1/users/*.
 *
 * Endpoints:
 *   GET    /me                  → current user (auth)
 *   PATCH  /me                  → update profile (auth)
 *   POST   /me/change-password  → change password (auth)
 *   DELETE /me                  → schedule deletion (auth)
 *   GET    /:id/public          → internal — includes email (no auth, for notification-service)
 *   GET    /:id                 → public profile (no auth, strips email)
 *
 * NOTE: The `/public` variant is called server-to-server by
 * notification-service to resolve recipient emails. Protect it
 * at the ingress layer (rate limit / IP allowlist).
 */

import { Router } from 'express';
import * as userController from '@/controllers/user.controller';
import { requireAuth } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validation.middleware';
import {
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from '@/types/index';
import { profileUpdateRateLimiter } from '@/middleware/rate-limit.middleware';

const router = Router();

// ============================================================
// AUTHENTICATED — current user
// ============================================================
router.get('/me', requireAuth, userController.getMe);

router.patch(
  '/me',
  requireAuth,
  profileUpdateRateLimiter,
  validateBody(updateProfileSchema),
  userController.updateMe,
);

router.post(
  '/me/change-password',
  requireAuth,
  profileUpdateRateLimiter,
  validateBody(changePasswordSchema),
  userController.changePassword,
);

router.delete(
  '/me',
  requireAuth,
  validateBody(deleteAccountSchema),
  userController.deleteMe,
);

// ============================================================
// PUBLIC — user profiles by ID
//
// /:id/public  → internal (includes email, for notification-service)
// /:id         → public-facing (no email)
// ============================================================
router.get('/:id/public', userController.getPublicProfileWithEmail);
router.get('/:id', userController.getPublicProfile);

export default router;