/**
 * AI routes — the SSE streaming endpoint + feedback.
 *
 * Endpoints:
 *   POST /ai/suggest   — SSE stream of a suggestion
 *   POST /ai/feedback  — rate a completed session (1-5 stars + comment)
 *
 * The /suggest endpoint is the primary user-facing feature:
 *   - Client sends operation + selection + instruction
 *   - Server streams chunks via SSE
 *   - Client may resume by re-POSTing with the same session_id
 *
 * The /feedback endpoint is used by the model eval pipeline; it does
 * not affect quota (feedback is free).
 */

import { Router } from 'express';
import * as aiController from '@/controllers/ai.controller';
import { requireAuth } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validation.middleware';
import { suggestRateLimiter, feedbackRateLimiter } from '@/middleware/rate-limit.middleware';
import { suggestSchema, feedbackSchema } from '@/types/index';

const router = Router();

// ============================================================
// AUTH REQUIRED
// ============================================================
router.use(requireAuth);

// ============================================================
// SSE STREAM
// ============================================================
/**
 * POST /api/v1/ai/suggest
 *
 * Body: { operation, selection, instruction?, sessionId?, tone? }
 * Response: text/event-stream
 *
 * Events emitted:
 *   event: chunk   { delta, index }
 *   event: usage   { tokens_in, tokens_out, model, quota_remaining }
 *   event: done    { session_id, finish_reason }
 *   event: error   { code, retryable }
 */
router.post(
  '/suggest',
  suggestRateLimiter,
  validateBody(suggestSchema),
  aiController.suggest,
);

// ============================================================
// FEEDBACK
// ============================================================
/**
 * POST /api/v1/ai/feedback
 *
 * Body: { sessionId, rating (1-5), comment? }
 * Response: 202 { message }
 */
router.post(
  '/feedback',
  feedbackRateLimiter,
  validateBody(feedbackSchema),
  aiController.feedback,
);

export default router;