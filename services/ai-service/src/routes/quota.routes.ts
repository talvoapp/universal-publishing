/**
 * Quota routes — read-only quota status.
 *
 * Endpoint:
 *   GET /quota — returns the current user's tier + usage
 *
 * Quota counters live in Redis and reset at UTC midnight via TTL.
 */

import { Router } from 'express';
import * as quotaController from '@/controllers/quota.controller';
import { requireAuth } from '@/middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/v1/quota
 * Response 200: {
 *   tier, limit, used, remaining, reset_at, warning_threshold_pct, at_warning
 * }
 */
router.get('/', quotaController.get);

export default router;