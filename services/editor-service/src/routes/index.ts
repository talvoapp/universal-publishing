/**
 * Route aggregator for editor-service.
 *
 * Mounts feature routers under /api/v1/<feature>:
 *   /api/v1/editor/*    — draft CRUD (create, get, list, update, publish, delete)
 *   /api/v1/versions/*  — draft version history (list, get, revert)
 *   /api/v1/taxonomy/*  — categories & tags
 */

import { Router } from 'express';
import draftRouter from '@/routes/draft.routes';
import versionRouter from '@/routes/version.routes';
import taxonomyRouter from '@/routes/taxonomy.routes';

const router = Router();

// ============================================================
// FEATURE ROUTES
// ============================================================
router.use('/editor', draftRouter);
router.use('/versions', versionRouter);
router.use('/taxonomy', taxonomyRouter);

// ============================================================
// API INDEX (informational)
// ============================================================
router.get('/', (_req, res) => {
  res.json({
    service: 'editor-service',
    version: '1.0.0',
    websocket: 'ws://<host>/editor/stream',
    endpoints: {
      editor: [
        'POST   /api/v1/editor/drafts',
        'GET    /api/v1/editor/drafts',
        'GET    /api/v1/editor/drafts/:id',
        'PATCH  /api/v1/editor/drafts/:id',
        'DELETE /api/v1/editor/drafts/:id',
        'POST   /api/v1/editor/drafts/:id/publish',
        'POST   /api/v1/editor/drafts/:id/snapshot',
        'POST   /api/v1/editor/drafts/:id/tags',
        'DELETE /api/v1/editor/drafts/:id/tags/:tag',
      ],
      versions: [
        'GET    /api/v1/versions/drafts/:id',
        'GET    /api/v1/versions/drafts/:id/:version',
        'POST   /api/v1/versions/drafts/:id/revert',
      ],
      taxonomy: [
        'GET    /api/v1/taxonomy/categories',
        'GET    /api/v1/taxonomy/tags',
      ],
    },
  });
});

export default router;