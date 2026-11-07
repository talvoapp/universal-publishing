/**
 * Route aggregator for ai-service.
 *
 * Mounts feature routers under /api/v1/<feature>:
 *   /api/v1/ai/*     — AI operations (suggest, feedback)
 *   /api/v1/quota/*  — quota queries
 */

import { Router } from 'express';
import aiRouter from '@/routes/ai.routes';
import quotaRouter from '@/routes/quota.routes';

const router = Router();

// ============================================================
// FEATURE ROUTES
// ============================================================
router.use('/ai', aiRouter);
router.use('/quota', quotaRouter);

// ============================================================
// API INDEX
// ============================================================
router.get('/', (_req, res) => {
  res.json({
    service: 'ai-service',
    version: '1.0.0',
    endpoints: {
      ai: [
        'POST /api/v1/ai/suggest    — stream AI suggestion (SSE)',
        'POST /api/v1/ai/feedback   — report quality (rate a session)',
      ],
      quota: [
        'GET  /api/v1/quota         — my current quota status',
      ],
    },
    tiers: {
      free: '5,000 tokens/day',
      premium: '100,000 tokens/day',
      admin: '1,000,000 tokens/day',
    },
    providers: ['openai', 'anthropic'],
  });
});

export default router;