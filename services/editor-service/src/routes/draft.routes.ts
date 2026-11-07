/**
 * Draft routes — CRUD + publish + snapshot + tags.
 *
 * All endpoints require authentication (requireAuth at router level).
 * Ownership/authorization is enforced in the service layer (not here).
 *
 * Endpoints:
 *   POST   /editor/drafts                    — create draft
 *   GET    /editor/drafts                    — list my drafts
 *   GET    /editor/drafts/:id                — get full draft
 *   PATCH  /editor/drafts/:id                — update metadata (title, tags, language)
 *   DELETE /editor/drafts/:id                — soft delete
 *   POST   /editor/drafts/:id/publish        — publish
 *   POST   /editor/drafts/:id/snapshot       — force snapshot
 *   POST   /editor/drafts/:id/tags           — add tags
 *   DELETE /editor/drafts/:id/tags/:tag      — remove a tag
 *
 * Note: CONTENT changes do NOT go through HTTP. They use WebSocket
 * patches (see /editor/stream). This router only touches metadata.
 */

import { Router } from 'express';
import * as draftController from '@/controllers/draft.controller';
import { requireAuth } from '@/middleware/auth.middleware';
import { validateBody, validateQuery, validateParams } from '@/middleware/validation.middleware';
import { draftCreateRateLimiter, publishRateLimiter } from '@/middleware/rate-limit.middleware';
import {
  createDraftSchema,
  updateDraftSchema,
  listDraftsQuerySchema,
  draftIdParamSchema,
  addTagsSchema,
} from '@/types/index';

const router = Router();

// ============================================================
// AUTH REQUIRED FOR EVERYTHING BELOW
// ============================================================
router.use(requireAuth);

// ============================================================
// CREATE
// ============================================================
/**
 * POST /api/v1/editor/drafts
 * Body: { title?, contentType, language?, metadata? }
 * Response 201: { draft }
 */
router.post(
  '/drafts',
  draftCreateRateLimiter,
  validateBody(createDraftSchema),
  draftController.create,
);

// ============================================================
// LIST
// ============================================================
/**
 * GET /api/v1/editor/drafts?status=draft&cursor=...&limit=20
 * Response 200: { data: Draft[], next_cursor }
 */
router.get(
  '/drafts',
  validateQuery(listDraftsQuerySchema),
  draftController.list,
);

// ============================================================
// GET ONE
// ============================================================
/**
 * GET /api/v1/editor/drafts/:id
 * Response 200: { draft }
 */
router.get(
  '/drafts/:id',
  validateParams(draftIdParamSchema),
  draftController.getOne,
);

// ============================================================
// UPDATE METADATA (content via WebSocket, not HTTP)
// ============================================================
/**
 * PATCH /api/v1/editor/drafts/:id
 * Body: { title?, language?, metadata? }
 * Requires: If-Match: <version> for optimistic concurrency
 * Response 200: { draft }
 */
router.patch(
  '/drafts/:id',
  validateParams(draftIdParamSchema),
  validateBody(updateDraftSchema),
  draftController.update,
);

// ============================================================
// DELETE (soft)
// ============================================================
/**
 * DELETE /api/v1/editor/drafts/:id
 * Response 204
 */
router.delete(
  '/drafts/:id',
  validateParams(draftIdParamSchema),
  draftController.remove,
);

// ============================================================
// PUBLISH
// ============================================================
/**
 * POST /api/v1/editor/drafts/:id/publish
 * Response 200: { draft } (with status='published')
 * Requires: verified email + at least 100 words of content
 */
router.post(
  '/drafts/:id/publish',
  publishRateLimiter,
  validateParams(draftIdParamSchema),
  draftController.publish,
);

// ============================================================
// FORCE SNAPSHOT
// ============================================================
/**
 * POST /api/v1/editor/drafts/:id/snapshot
 * Response 200: { version, snapshot_at }
 * Useful before risky edits or when the client wants to bookmark a state.
 */
router.post(
  '/drafts/:id/snapshot',
  validateParams(draftIdParamSchema),
  draftController.snapshot,
);

// ============================================================
// TAGS
// ============================================================
/**
 * POST /api/v1/editor/drafts/:id/tags
 * Body: { tags: string[] }
 * Response 200: { draft }
 */
router.post(
  '/drafts/:id/tags',
  validateParams(draftIdParamSchema),
  validateBody(addTagsSchema),
  draftController.addTags,
);

/**
 * DELETE /api/v1/editor/drafts/:id/tags/:tag
 * Response 200: { draft }
 */
router.delete(
  '/drafts/:id/tags/:tag',
  validateParams(draftIdParamSchema),
  draftController.removeTag,
);

export default router;