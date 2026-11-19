/**
 * AI API — streaming suggestions via SSE.
 *
 * The AI service uses Server-Sent Events (SSE) for streaming responses.
 * React Native doesn't support EventSource natively, so we use
 * `react-native-sse` or fall back to polling.
 *
 * For v1, we use fetch with a stream reader (works in RN 0.74+).
 */

import { clients, API_BASE_URLS } from './client';
import { tokenStorage } from './tokens';

export interface SuggestInput {
  operation: 'grammar' | 'rephrase' | 'summarize' | 'expand' | 'generate';
  selection: { text: string };
  instruction?: string;
  tone?: string;
  targetLanguage?: string;
}

export interface StreamChunk {
  delta: string;
}

export const aiApi = {
  /**
   * Stream a suggestion using fetch + ReadableStream.
   * Works on RN 0.74+ (Hermes with fetch polyfill).
   */
  streamSuggest: async (
    input: SuggestInput,
    onChunk: (chunk: StreamChunk) => void,
    onDone?: () => void,
    onError?: (err: Error) => void,
  ): Promise<void> => {
    try {
      const token = await tokenStorage.getAccessToken();
      if (!token) throw new Error('Not authenticated');

      const url = `${API_BASE_URLS.ai}/api/v1/ai/suggest`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`AI stream failed: ${response.status} ${text.slice(0, 200)}`);
      }

      if (!response.body) {
        throw new Error('AI stream returned empty body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data) as { delta?: string };
              if (parsed.delta) {
                onChunk({ delta: parsed.delta });
              }
            } catch {
              // Skip malformed frames
            }
          }
        }
      }

      onDone?.();
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  },

  /** Get current quota status */
  getQuota: async (): Promise<{
    tier: string;
    used: number;
    limit: number;
    remaining: number;
    resetAt: string;
  }> => {
    const { data } = await clients.ai.get('/api/v1/quota');
    return data;
  },
};