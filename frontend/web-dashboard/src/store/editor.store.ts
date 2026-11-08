/**
 * Editor store (Zustand).
 *
 * Tracks the current draft + local changes + WS connection state.
 *
 * KEY PRINCIPLE: content changes go through the WebSocket (not HTTP).
 * This store is a projection of the server's state. When a patch is
 * ack'd, we bump `version` and clear local `dirty` flag.
 */

import { create } from 'zustand';
import type { Draft, WSFrame, WSEvent } from '@/types';

// ============================================================
// STATE
// ============================================================
interface EditorState {
  // Draft data
  draft: Draft | null;
  loading: boolean;
  error: string | null;

  // Connection state
  wsConnected: boolean;
  wsAuthenticated: boolean;

  // Sync state
  currentVersion: number;
  lastAckVersion: number;
  pendingOps: number; // count of ops sent but not ack'd
  dirty: boolean; // has unflushed changes

  // Presence
  activeUsers: Array<{ userId: string; cursorPosition: number | null }>;

  // Actions
  setDraft: (draft: Draft) => void;
  clear: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setWsConnected: (connected: boolean) => void;
  setWsAuthenticated: (auth: boolean) => void;
  handleWsEvent: (event: WSEvent) => void;
  setPresence: (users: Array<{ userId: string; cursorPosition: number | null }>) => void;
  markDirty: () => void;
}

// ============================================================
// STORE
// ============================================================
export const useEditorStore = create<EditorState>((set, get) => ({
  draft: null,
  loading: false,
  error: null,
  wsConnected: false,
  wsAuthenticated: false,
  currentVersion: 0,
  lastAckVersion: 0,
  pendingOps: 0,
  dirty: false,
  activeUsers: [],

  setDraft: (draft) =>
    set({
      draft,
      currentVersion: draft.version,
      lastAckVersion: draft.version,
      pendingOps: 0,
      dirty: false,
    }),

  clear: () =>
    set({
      draft: null,
      wsConnected: false,
      wsAuthenticated: false,
      currentVersion: 0,
      lastAckVersion: 0,
      pendingOps: 0,
      dirty: false,
      activeUsers: [],
      error: null,
    }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setWsConnected: (connected) => set({ wsConnected: connected }),
  setWsAuthenticated: (auth) => set({ wsAuthenticated: auth }),

  handleWsEvent: (event) => {
    const state = get();

    switch (event.type) {
      case 'auth_ok':
        set({ wsAuthenticated: true });
        break;

      case 'subscribed':
        set({
          currentVersion: event.version,
          lastAckVersion: event.version,
        });
        break;

      case 'ack':
        set({
          lastAckVersion: event.version,
          currentVersion: Math.max(state.currentVersion, event.version),
          pendingOps: Math.max(0, state.pendingOps - 1),
          dirty: state.pendingOps - 1 > 0,
        });
        break;

      case 'nack':
        // Server rejected — client should rebase
        // (handled by the useEditor hook which has access to TipTap)
        set({ error: `Sync conflict: ${event.reason}` });
        break;

      case 'patch':
        // Remote patch applied — update current version
        set({ currentVersion: Math.max(state.currentVersion, event.version) });
        break;

      case 'presence':
        set({
          activeUsers: event.users.map((u) => ({
            userId: u.userId,
            cursorPosition: u.cursorPosition,
          })),
        });
        break;

      case 'error':
        set({ error: `${event.code}: ${event.detail}` });
        break;

      case 'pong':
        // Heartbeat — no state change needed
        break;
    }
  },

  setPresence: (users) => set({ activeUsers: users }),

  markDirty: () => set({ dirty: true, pendingOps: get().pendingOps + 1 }),
}));