/**
 * Version routes — draft history and revert.
 *
 * Every applied patch produces a `draft_ops` row. A "version" in this
 * context is a snapshot checkpoint. Reverting to a version applies a
 * new op that resets content to that version's content (append-only).
 */

import { Router } from 'express';
import * as versionController from '@/controllers/version.controller';
import { requireAuth } from '@/middleware/auth.middleware';
import { validateBody, validateQuery, validateParams } from '@/middleware/validation.middleware';
import { revertRateLimiter } from '@/middleware/rate-limit.middleware';
import {
  listVersionsQuerySchema,
  versionParamSchema,
  revertSchema,
} from '@/types/index';

const router = Router();

// ============================================================
// AUTH REQUIRED
// ============================================================
router.use(requireAuth);

// ============================================================
// LIST VERSIONS
// ============================================================
/**
 * GET /api/v1/versions/drafts/:id?cursor=...&limit=20
 * Response 200: { data: VersionEntry[], next_cursor }
 */
router.get(
  '/drafts/:id',
  validateParams(versionParamSchema.pick({ id: true })),
  validateQuery(listVersionsQuerySchema),
  versionController.list,
);

// ============================================================
// GET SPECIFIC VERSION
// ============================================================
/**
 * GET /api/v1/versions/drafts/:id/:version
 * Response 200: { version, content, metadata, createdAt, createdBy }
 */
router.get(
  '/drafts/:id/:version',
  validateParams(versionParamSchema),
  versionController.getOne,
);

// ============================================================
// REVERT
// ============================================================
/**
 * POST /api/v1/versions/drafts/:id/revert
 * Body: { to_version }
 * Response 200: { draft, new_version }
 * Creates a NEW version whose content matches the target version's content.
 * Does not modify history — append-only.
 */
router.post(
  '/drafts/:id/revert',
  revertRateLimiter,
  validateParams(versionParamSchema.pick({ id: true })),
  validateBody(revertSchema),
  versionController.revert,
);

export default router;