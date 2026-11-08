/**
 * WebSocket hook — connection + reconnect + event handling.
 *
 * Usage:
 *   const { connected, send } = useWebSocket({
 *     draftId,
 *     onEvent: (event) => { ... },
 *   });
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { WSFrame, WSEvent } from '@/types';
import { tokenStorage } from '@/api/client';

// ============================================================
// CONFIG
// ============================================================
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/editor/stream';

// ============================================================
// HOOK
// ============================================================
interface UseWebSocketOptions {
  draftId: string | null;
  onEvent: (event: WSEvent) => void;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  connected: boolean;
  send: (frame: WSFrame) => void;
  close: () => void;
}

export function useWebSocket({
  draftId,
  onEvent,
  enabled = true,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // ============================================================
  // CONNECT
  // ============================================================
  const connect = useCallback(() => {
    if (!enabled || !draftId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const token = tokenStorage.getAccessToken();
    if (!token) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;

        // Send auth frame
        ws.send(JSON.stringify({ type: 'auth', token } satisfies WSFrame));
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WSEvent;

          // On auth_ok, subscribe to the draft
          if (event.type === 'auth_ok' && draftId) {
            ws.send(JSON.stringify({ type: 'subscribe', draftId } satisfies WSFrame));
          }

          onEventRef.current(event);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[WS] Failed to parse message:', err);
        }
      };

      ws.onerror = () => {
        // eslint-disable-next-line no-console
        console.warn('[WS] Connection error');
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // Reconnect with exponential backoff (max 30s)
        if (enabled && draftId) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30_000);
          reconnectAttempts.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WS] Failed to create connection:', err);
    }
  }, [enabled, draftId]);

  // ============================================================
  // LIFECYCLE
  // ============================================================
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Component unmounted');
      }
    };
  }, [connect]);

  // ============================================================
  // ACTIONS
  // ============================================================
  const send = useCallback((frame: WSFrame) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  }, []);

  const close = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) ws.close(1000, 'Manual close');
    setConnected(false);
  }, []);

  return { connected, send, close };
}