/**
 * AI API client (SSE streaming).
 *
 * The /ai/suggest endpoint uses Server-Sent Events (SSE) — not a normal
 * fetch. We provide a helper to consume the stream with an async iterator.
 */

import { tokenStorage } from './client';
import type { AISuggestRequest, AIQuota } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

// ============================================================
// QUOTA
// ============================================================
export const aiApi = {
  getQuota: async (): Promise<AIQuota> => {
    const token = tokenStorage.getAccessToken();
    const response = await fetch(`${API_BASE_URL}/api/v1/quota`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error(`Quota fetch failed: ${response.status}`);
    return response.json();
  },

  // ============================================================
  // SSE STREAMING
  // ============================================================
  /**
   * Streams AI suggestions. Calls the `onEvent` callback for each frame.
   * Returns an AbortController so the caller can cancel the stream.
   */
  suggestStream: (
    input: AISuggestRequest,
    onEvent: (event: SSEEvent) => void,
  ): AbortController => {
    const controller = new AbortController();
    const token = tokenStorage.getAccessToken();

    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/ai/suggest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({
            code: 'UNKNOWN',
            detail: `HTTP ${response.status}`,
          }));
          onEvent({ type: 'error', data: error });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onEvent({ type: 'error', data: { code: 'NO_BODY', detail: 'Empty stream' } });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by \n\n
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const parsed = parseSSEFrame(frame);
            if (parsed) onEvent(parsed);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          onEvent({ type: 'aborted', data: null });
          return;
        }
        onEvent({ type: 'error', data: { code: 'STREAM_ERROR', detail: String(err) } });
      }
    })();

    return controller;
  },

  // ============================================================
  // FEEDBACK
  // ============================================================
  sendFeedback: async (sessionId: string, rating: number, comment?: string): Promise<void> => {
    const token = tokenStorage.getAccessToken();
    await fetch(`${API_BASE_URL}/api/v1/ai/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId, rating, comment }),
    });
  },
};

// ============================================================
// SSE PARSING
// ============================================================
export type SSEEventType = 'chunk' | 'usage' | 'done' | 'error' | 'aborted';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

function parseSSEFrame(frame: string): SSEEvent | null {
  const lines = frame.split('\n');
  let eventType: string | null = null;
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      dataStr += line.slice(6);
    }
  }

  if (!eventType || !dataStr) return null;

  try {
    const data = JSON.parse(dataStr);
    return { type: eventType as SSEEventType, data };
  } catch {
    return null;
  }
}