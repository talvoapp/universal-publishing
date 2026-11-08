/**
 * Auth store for mobile — Zustand + SecureStore.
 *
 * ─── DEPENDENCIES ───
 *   - tokenStorage from `@/api/tokens` (no cycle)
 *   - authApi/userApi from `@/api/auth.api` (which imports apiClient)
 *
 * The store doesn't store tokens directly. Tokens live in SecureStore,
 * accessed via tokenStorage. This keeps token access async-safe and
 * avoids persisting sensitive data in Zustand state.
 */

import { create } from 'zustand';
import type { User } from '@/types';
import { authApi, userApi } from '@/api/auth.api';
import { tokenStorage } from '@/api/tokens';
import { getErrorMessage } from '@/api/client';

// ============================================================
// STATE
// ============================================================
interface AuthState {
  // Data
  user: User | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;

  // Derived
  isAuthenticated: () => boolean;

  // Actions
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

// ============================================================
// STORE
// ============================================================
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  loading: false,
  error: null,

  isAuthenticated: () => get().user !== null,

  // ==========================================================
  // HYDRATE — called on app start
  // ==========================================================
  hydrate: async () => {
    const token = await tokenStorage.getAccessToken();
    if (!token) {
      set({ hydrated: true });
      return;
    }

    try {
      const { user } = await userApi.getMe();
      set({ user, hydrated: true, error: null });
    } catch {
      // Token invalid/expired → clear everything
      await tokenStorage.clear();
      set({ user: null, hydrated: true });
    }
  },

  // ==========================================================
  // LOGIN
  // ==========================================================
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const data = await authApi.login({ email, password });
      await tokenStorage.setTokens(data.accessToken, data.refreshToken);
      set({
        user: data.user,
        loading: false,
        hydrated: true,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: getErrorMessage(err),
      });
      throw err;
    }
  },

  // ==========================================================
  // REGISTER
  // ==========================================================
  register: async (email, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const data = await authApi.register({ email, password, displayName });
      await tokenStorage.setTokens(data.accessToken, data.refreshToken);
      set({
        user: data.user,
        loading: false,
        hydrated: true,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: getErrorMessage(err),
      });
      throw err;
    }
  },

  // ==========================================================
  // LOGOUT
  // ==========================================================
  logout: async () => {
    const refreshToken = await tokenStorage.getRefreshToken();
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } catch {
      // Ignore server errors — clear tokens anyway
    }
    await tokenStorage.clear();
    set({ user: null, error: null });
  },

  clearError: () => set({ error: null }),
}));