/**
 * Taxonomy routes — categories & tags.
 *
 * Public (no auth required):
 *   GET /taxonomy/categories        — hierarchical categories
 *   GET /taxonomy/tags?q=...        — tag autocomplete
 *
 * Both are heavily cached (Redis + CDN), so no rate limit beyond global.
 */

import { Router } from 'express';
import * as taxonomyController from '@/controllers/taxonomy.controller';
import { validateQuery } from '@/middleware/validation.middleware';
import { searchTagsQuerySchema } from '@/types/index';

const router = Router();

// ============================================================
// CATEGORIES (cached 1h)
// ============================================================
router.get('/categories', taxonomyController.listCategories);

// ============================================================
// TAGS (autocomplete, cached 5m)
// ============================================================
router.get(
  '/tags',
  validateQuery(searchTagsQuerySchema),
  taxonomyController.searchTags,
);

export default router;