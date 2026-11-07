/**
 * Route aggregator.
 *
 * Mounts each feature router under `/api/v1/<feature>` so that
 * `app.ts` can do `app.use('/api/v1', apiRouter)` and never have
 * to know about individual sub-routers.
 *
 * Add new routes here as the service grows.
 */

import { Router } from 'express';
import authRouter from '@/routes/auth.routes';
import userRouter from '@/routes/user.routes';
import oauthRouter from '@/routes/oauth.routes';

const router = Router();

// ============================================================
// HEALTH / READINESS (mounted at app level, not here — see app.ts)
// ============================================================

// ============================================================
// FEATURE ROUTES
// ============================================================
router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/oauth', oauthRouter);

// ============================================================
// API INDEX (informational — helpful for debugging)
// ============================================================
router.get('/', (_req, res) => {
  res.json({
    service: 'auth-service',
    version: '1.0.0',
    endpoints: {
      auth: [
        'POST   /api/v1/auth/register',
        'POST   /api/v1/auth/login',
        'POST   /api/v1/auth/refresh',
        'POST   /api/v1/auth/logout',
        'POST   /api/v1/auth/logout-all',
        'POST   /api/v1/auth/forgot-password',
        'POST   /api/v1/auth/reset-password',
        'POST   /api/v1/auth/verify-email',
        'POST   /api/v1/auth/resend-verification',
      ],
      users: [
        'GET    /api/v1/users/me',
        'PATCH  /api/v1/users/me',
        'POST   /api/v1/users/me/change-password',
        'DELETE /api/v1/users/me',
        'GET    /api/v1/users/:id (public profile)',
      ],
      oauth: [
        'GET    /api/v1/oauth/google',
        'GET    /api/v1/oauth/google/callback',
        'GET    /api/v1/oauth/github',
        'GET    /api/v1/oauth/github/callback',
      ],
    },
  });
});

export default router;