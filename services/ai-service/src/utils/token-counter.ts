/**
 * Token counter — accurate token estimation before quota reservation.
 *
 * Design:
 *   - The quota system needs a "reservation" number BEFORE the provider
 *     returns actual usage. Over-estimating is safe (we refund the
 *     difference after); under-estimating lets users exceed their limit.
 *   - We use `tiktoken` (OpenAI's official tokenizer) for English text,
 *     which matches GPT-4o's tokenizer closely.
 *   - Anthropic's tokenizer differs slightly, but tiktoken is a good
 *     approximation (±10%).
 *   - For unknown operations, we fall back to char-based heuristic
 *     (`ceil(chars / 3)`), which over-estimates by design.
 *
 * Exports:
 *   - `estimateInputTokens(input)` — for quota reservation
 *   - `estimateOutputTokens(operation, inputChars)` — for safety headroom
 *   - `countTokens(text)` — low-level (used by tests)
 *
 * Note: The actual token usage reported by providers is always
 * authoritative. These estimates are only used for the initial
 * reservation; `quota.service.recordActualUsage` corrects the ledger.
 */

import { encoding_for_model, type TiktokenModel } from 'tiktoken';
import type { SuggestInput } from '@/types/index';
import { createLogger } from '@/utils/logger';

const log = createLogger('token-counter');

// ============================================================
// CONSTANTS
// ============================================================
/** System prompt overhead per request (character count) */
const SYSTEM_PROMPT_CHARS = 200;
/** Per-operation expected output ratio (output tokens / input tokens) */
const OUTPUT_RATIO: Record<SuggestInput['operation'], number> = {
  grammar: 1.1,     // similar length
  rephrase: 1.2,    // slightly longer
  summarize: 0.3,   // much shorter
  expand: 2.0,      // roughly 2x
  generate: 1.5,    // moderate generation
};

// ============================================================
// ENCODER (lazy, cached)
// ============================================================
let encoder: ReturnType<typeof encoding_for_model> | null = null;
let encoderModel: string | null = null;

/**
 * Returns a tiktoken encoder for the given model.
 * Uses `gpt-4o` as the default — it's close enough for both providers.
 * Falls back to `null` if tiktoken fails to load (rare).
 */
function getEncoder(model = 'gpt-4o'): ReturnType<typeof encoding_for_model> | null {
  if (encoder && encoderModel === model) return encoder;
  try {
    encoder = encoding_for_model(model as TiktokenModel);
    encoderModel = model;
    return encoder;
  } catch (err) {
    log.warn({ err, model }, 'Failed to load tokenizer — falling back to char heuristic');
    return null;
  }
}

// ============================================================
// LOW-LEVEL COUNT
// ============================================================
/**
 * Count tokens in `text` using tiktoken.
 * Falls back to `ceil(chars / 3)` if the encoder can't load.
 */
export function countTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  const enc = getEncoder();
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch (err) {
      log.warn({ err }, 'tiktoken encode failed — using heuristic');
    }
  }

  // Heuristic: ~4 chars per token for English, ~3 for mixed content
  // (Arabic/CJK tokens are roughly 1-2 chars each, so /3 is safer).
  return Math.ceil(text.length / 3);
}

// ============================================================
// ESTIMATE INPUT TOKENS
// ============================================================
/**
 * Estimates the input token count for a suggestion request.
 * Includes: selection text + instruction + system prompt overhead.
 *
 * This is the value used for quota RESERVATION. It should be an
 * UPPER bound to avoid overspend.
 */
export function estimateInputTokens(input: SuggestInput): number {
  let tokens = countTokens(input.selection.text ?? '');
  tokens += countTokens(input.instruction ?? '');
  tokens += countTokens('x'.repeat(SYSTEM_PROMPT_CHARS)); // system prompt overhead

  // Add ~10% safety margin for prompt formatting, delimiter tokens, etc.
  return Math.ceil(tokens * 1.1);
}

// ============================================================
// ESTIMATE OUTPUT TOKENS
// ============================================================
/**
 * Estimates how many output tokens the provider will produce.
 * Used to:
 *   - Bound the reservation (`maxOutputTokens` from config is the cap)
 *   - Inform the stream handler about expected stream duration
 *
 * Returns the MINIMUM of:
 *   - operation-specific ratio × input tokens
 *   - configured maxOutputTokens (hard cap)
 */
export function estimateOutputTokens(
  operation: SuggestInput['operation'],
  inputTokens: number,
  maxOutputCap: number,
): number {
  const ratio = OUTPUT_RATIO[operation];
  const projected = Math.ceil(inputTokens * ratio);
  return Math.min(projected, maxOutputCap);
}

// ============================================================
// TOTAL RESERVATION
// ============================================================
/**
 * Convenience: computes the total tokens to reserve for a request.
 * This is what quota.service uses.
 */
export function estimateReservationTokens(
  input: SuggestInput,
  maxOutputCap: number,
): {
  inputTokens: number;
  expectedOutputTokens: number;
  totalReservation: number;
} {
  const inputTokens = estimateInputTokens(input);
  const expectedOutputTokens = estimateOutputTokens(
    input.operation,
    inputTokens,
    maxOutputCap,
  );
  return {
    inputTokens,
    expectedOutputTokens,
    totalReservation: inputTokens + expectedOutputTokens,
  };
}

// ============================================================
// TEST-ONLY: RESET ENCODER
// ============================================================
/**
 * Frees the cached encoder. Called from `tests/setup.ts` afterEach
 * to avoid cross-test contamination.
 */
export function _resetEncoderForTests(): void {
  if (encoder) {
    try { encoder.free(); } catch { /* ignore */ }
  }
  encoder = null;
  encoderModel = null;
}