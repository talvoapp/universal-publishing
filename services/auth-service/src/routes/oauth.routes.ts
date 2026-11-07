/**
 * OAuth routes — Google & GitHub.
 *
 * All logic lives in `controllers/oauth.controller.ts`. This file is
 * purely declarative: it wires URLs to handlers and nothing else.
 *
 * Flows:
 *   GET /api/v1/oauth/google                → consent screen
 *   GET /api/v1/oauth/google/callback       → tokens → redirect to frontend
 *   GET /api/v1/oauth/github                → consent screen
 *   GET /api/v1/oauth/github/callback       → tokens → redirect to frontend
 *
 * Note: `services/oauth.service.ts` registers the Passport strategies
 * as a side effect of import. It must be imported before any handler
 * runs — which is why it lives in the controller layer.
 */

import { Router } from 'express';
import * as oauthController from '@/controllers/oauth.controller';

const router = Router();

// Google
router.get('/google', oauthController.googleAuth);
router.get('/google/callback', oauthController.googleCallback);

// GitHub
router.get('/github', oauthController.githubAuth);
router.get('/github/callback', oauthController.githubCallback);

export default router;