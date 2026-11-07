/**
 * Fallback orchestrator — tries primary provider, then fallback.
 *
 * Rules:
 *   - Try the configured primary provider first.
 *   - On a `ProviderUnavailableError` (or timeout), try the fallback
 *     (if enabled and configured).
 *   - User aborts (`AbortError`) are NOT retried — they must propagate.
 *   - Other errors (auth misconfiguration) are NOT retried either.
 *
 * Returns the final `StreamResult` including the provider that produced it.
 */

import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { ProviderUnavailableError } from '@/utils/errors';
import * as openaiService from '@/services/openai.service';
import * as anthropicService from '@/services/anthropic.service';
import type { SuggestInput } from '@/types/index';
import type { StreamResult } from '@/services/openai.service';

const log = createLogger('fallback.service');

export interface RunOptions {
  input: SuggestInput;
  signal: AbortSignal;
  onChunk: (chunk: { delta: string }) => Promise<void> | void;
}

export interface RunResult extends StreamResult {
  provider: 'openai' | 'anthropic';
}

// ============================================================
// MAIN
// ============================================================
export async function run(opts: RunOptions): Promise<RunResult> {
  const primary = config.providers.primary;
  const fallback = config.providers.fallback;

  try {
    const result = await tryProvider(primary, opts);
    return { ...result, provider: primary };
  } catch (err) {
    if (isAbort(err)) throw err;

    const canFallback =
      config.providers.enableFallback &&
      fallback !== primary &&
      hasKey(fallback);

    if (!canFallback || !(err instanceof ProviderUnavailableError)) {
      // Non-retryable error or no fallback available.
      throw err;
    }

    log.warn(
      { err, primary, fallback },
      'Primary provider failed; attempting fallback',
    );

    const result = await tryProvider(fallback, opts);
    return { ...result, provider: fallback };
  }
}

// ============================================================
// HELPERS
// ============================================================
async function tryProvider(
  provider: 'openai' | 'anthropic',
  opts: RunOptions,
): Promise<StreamResult> {
  if (provider === 'openai') {
    return openaiService.stream(opts);
  }
  return anthropicService.stream(opts);
}

function hasKey(provider: 'openai' | 'anthropic'): boolean {
  return provider === 'openai'
    ? Boolean(config.providers.openai)
    : Boolean(config.providers.anthropic);
}

function isAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || /abort/i.test(err.message);
}