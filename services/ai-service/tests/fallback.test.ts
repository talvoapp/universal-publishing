/**
 * Fallback service — provider failover tests.
 *
 * We control the mocks per test to simulate provider failures.
 */

import * as fallbackService from '@/services/fallback.service';
import { ProviderUnavailableError } from '@/utils/errors';
import type { SuggestInput } from '@/types/index';

// ------------------------------------------------------------
// MOCKS (defaults — overridden per test)
// ------------------------------------------------------------
const openaiStreamMock = jest.fn();
const anthropicStreamMock = jest.fn();

jest.mock('@/services/openai.service', () => ({
  stream: (...args: unknown[]) => openaiStreamMock(...args),
}));

jest.mock('@/services/anthropic.service', () => ({
  stream: (...args: unknown[]) => anthropicStreamMock(...args),
}));

// Ensure both providers are configured so hasKey() returns true.
jest.mock('@/config', () => {
  const actual = jest.requireActual('@/config');
  return {
    config: {
      ...actual.config,
      providers: {
        ...actual.config.providers,
        primary: 'openai',
        fallback: 'anthropic',
        enableFallback: true,
        openai: actual.config.providers.openai ?? {
          apiKey: 'test', model: 'gpt-4o', maxOutputTokens: 100, timeoutMs: 1000,
        },
        anthropic: actual.config.providers.anthropic ?? {
          apiKey: 'test', model: 'claude', maxOutputTokens: 100, timeoutMs: 1000,
        },
      },
    },
  };
});

const input: SuggestInput = {
  operation: 'grammar',
  selection: { text: 'test' },
};

const signal = new AbortController().signal;

beforeEach(() => {
  openaiStreamMock.mockReset();
  anthropicStreamMock.mockReset();
});

// ============================================================
// TESTS
// ============================================================
describe('fallbackService.run', () => {
  it('returns the primary provider result on success', async () => {
    openaiStreamMock.mockResolvedValueOnce({
      tokensIn: 10,
      tokensOut: 5,
      finishReason: 'stop',
      model: 'gpt-4o',
    });

    const res = await fallbackService.run({
      input,
      signal,
      onChunk: () => undefined,
    });
    expect(res.provider).toBe('openai');
    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });

  it('falls back to the secondary provider on ProviderUnavailableError', async () => {
    openaiStreamMock.mockRejectedValueOnce(new ProviderUnavailableError('down', 'OPENAI_FAILED'));
    anthropicStreamMock.mockResolvedValueOnce({
      tokensIn: 12,
      tokensOut: 7,
      finishReason: 'end_turn',
      model: 'claude',
    });

    const res = await fallbackService.run({
      input,
      signal,
      onChunk: () => undefined,
    });
    expect(res.provider).toBe('anthropic');
    expect(anthropicStreamMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-retryable error immediately', async () => {
    openaiStreamMock.mockRejectedValueOnce(new Error('bad request (400)'));

    await expect(
      fallbackService.run({ input, signal, onChunk: () => undefined }),
    ).rejects.toThrow('bad request');

    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });

  it('does NOT fallback when the error is an abort', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    openaiStreamMock.mockRejectedValueOnce(abortErr);

    await expect(
      fallbackService.run({ input, signal, onChunk: () => undefined }),
    ).rejects.toThrow('aborted');

    expect(anthropicStreamMock).not.toHaveBeenCalled();
  });
});