/**
 * AI controller — thin HTTP/SSE layer.
 *
 * The `suggest` handler is special: it delegates the entire SSE
 * lifecycle to `stream.handler.ts` (which owns headers, keepalive,
 * resume, and termination).
 */

import type { Request, Response, NextFunction } from 'express';
import { getCurrentUser } from '@/middleware/auth.middleware';
import * as quotaService from '@/services/quota.service';
import * as streamHandler from '@/sse/stream.handler';
import { createLogger } from '@/utils/logger';
import type { SuggestInput, FeedbackInput } from '@/types/index';

const log = createLogger('ai.controller');

// ============================================================
// SUGGEST (SSE)
// ============================================================
export async function suggest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = getCurrentUser(req);
  const input = req.body as SuggestInput;

  try {
    // Quota check happens BEFORE opening the SSE stream so we can
    // return a proper JSON 429 (not an SSE error event).
    const quota = await quotaService.checkAndReserveQuota({
      userId: user.id,
      role: user.role,
      estimatedTokens: estimateInputTokens(input),
    });

    // Attach quota info as headers (before streaming starts).
    res.setHeader('X-AI-Quota-Limit', String(quota.limit));
    res.setHeader('X-AI-Quota-Remaining', String(quota.remaining));
    res.setHeader('X-AI-Quota-Reset', quota.resetAt);

    // Delegate to the stream handler — this takes over the response
    // and never returns until the stream ends.
    await streamHandler.handleSuggestStream({
      req,
      res,
      user: { id: user.id, role: user.role },
      input,
      quota,
    });
  } catch (err) {
    // If we haven't started streaming yet, let the error middleware
    // format a proper JSON response.
    if (!res.headersSent) return next(err);
    // Otherwise log and close — the stream handler should handle its
    // own errors, so reaching here is a bug.
    log.error({ err, requestId: req.id }, 'Unhandled error after headers sent');
    try { res.end(); } catch { /* ignore */ }
  }
}

// ============================================================
// FEEDBACK
// ============================================================
export async function feedback(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const input = req.body as FeedbackInput;

  log.info(
    {
      userId: user.id,
      sessionId: input.sessionId,
      rating: input.rating,
      hasComment: Boolean(input.comment),
    },
    'AI feedback received',
  );

  // v1: feedback is only logged. In v2, we persist to a dedicated
  // `ai_feedback` collection for model evaluation.
  res.status(202).json({ message: 'Feedback received' });
}

// ============================================================
// HELPERS
// ============================================================
/**
 * Rough token estimate for the input (used for quota reservation).
 * We err on the side of OVER-estimating to prevent overspend.
 *
 * Rule of thumb: 1 token ≈ 4 English chars ≈ 0.75 words.
 * For safety we use ceil(chars / 3).
 */
function estimateInputTokens(input: SuggestInput): number {
  const text = input.selection.text ?? '';
  const instruction = input.instruction ?? '';
  const chars = text.length + instruction.length + 200; // +200 for system prompt
  return Math.ceil(chars / 3);
}