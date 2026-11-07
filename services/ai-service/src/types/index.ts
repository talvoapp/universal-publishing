/**
 * Zod schemas for AI request validation.
 *
 * Operations supported:
 *   grammar    — fix grammar, punctuation, spelling
 *   rephrase   — reword while keeping meaning
 *   summarize  — condense
 *   expand     — add detail
 *   generate   — produce text from a short instruction
 *
 * Tone modifier is optional and applies to rephrase/generate.
 */

import { z } from 'zod';

// ============================================================
// OPERATIONS
// ============================================================
export const OPERATIONS = ['grammar', 'rephrase', 'summarize', 'expand', 'generate'] as const;
export type Operation = (typeof OPERATIONS)[number];

export const TONES = ['neutral', 'formal', 'casual', 'friendly', 'authoritative'] as const;
export type Tone = (typeof TONES)[number];

// ============================================================
// SUGGEST
// ============================================================
/**
 * Body for POST /ai/suggest.
 *
 * `selection`: either a character range in the draft OR an explicit
 *              text snippet (used when the client doesn't track the
 *              draft server-side yet).
 *
 * If `sessionId` is provided, this is a RESUME request — the server
 * looks up the previous stream and continues from where it left off.
 * If the session has expired or completed, a fresh stream starts.
 */
export const suggestSchema = z
  .object({
    draftId: z.string().uuid().optional(),
    operation: z.enum(OPERATIONS),
    selection: z
      .object({
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
        text: z.string().min(1).max(20_000).optional(),
      })
      .refine(
        (s) => (s.from !== undefined && s.to !== undefined) || s.text !== undefined,
        'Either {from,to} or {text} must be provided',
      )
      .refine(
        (s) => s.from === undefined || s.to === undefined || s.from <= s.to,
        'from must be <= to',
      ),
    instruction: z.string().max(2_000).optional(),
    tone: z.enum(TONES).optional(),
    sessionId: z.string().uuid().optional(),
    targetLanguage: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
  })
  .strict();

export type SuggestInput = z.infer<typeof suggestSchema>;

// ============================================================
// FEEDBACK
// ============================================================
export const feedbackSchema = z
  .object({
    sessionId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1_000).optional(),
  })
  .strict();

export type FeedbackInput = z.infer<typeof feedbackSchema>;

// ============================================================
// QUOTA
// ============================================================
export interface QuotaStatus {
  tier: 'free' | 'premium' | 'admin';
  limit: number;
  used: number;
  remaining: number;
  reset_at: string;
  warning_threshold_pct: number;
  at_warning: boolean;
}