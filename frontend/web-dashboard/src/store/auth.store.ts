/**
 * Authentication store (Zustand).
 *
 * Persists access token in localStorage (via apiClient).
 * `hydrate()` is called on app mount to load the user from /users/me
 * if a token exists.
 */

import { create } from 'zustand';
import type { User, AuthRole } from '@/types';
import { authApi, userApi } from '@/api/auth.api';
import { tokenStorage, getErrorMessage } from '@/api/client';
import type { LoginInput, RegisterInput } from '@/utils/validation';

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
  hasRole: (role: AuthRole) => boolean;
  isAuthor: () => boolean;
  isAdmin: () => boolean;

  // Actions
  hydrate: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl' | 'language'>>) => Promise<void>;
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
  hasRole: (role) => get().user?.role === role,
  isAuthor: () => {
    const role = get().user?.role;
    return role === 'author' || role === 'editor' || role === 'admin';
  },
  isAdmin: () => get().user?.role === 'admin',

  hydrate: async () => {
    const token = tokenStorage.getAccessToken();
    if (!token) {
      set({ hydrated: true });
      return;
    }

    try {
      const { user } = await userApi.getMe();
      set({ user, hydrated: true, error: null });
    } catch {
      // Token invalid → clear + mark hydrated
      tokenStorage.clear();
      set({ user: null, hydrated: true });
    }
  },

  login: async (input) => {
    set({ loading: true, error: null });
    try {
      const data = await authApi.login(input);
      set({ user: data.user, loading: false, hydrated: true, error: null });
    } catch (err) {
      set({ loading: false, error: getErrorMessage(err) });
      throw err;
    }
  },

  register: async (input) => {
    set({ loading: true, error: null });
    try {
      const data = await authApi.register(input);
      set({ user: data.user, loading: false, hydrated: true, error: null });
    } catch (err) {
      set({ loading: false, error: getErrorMessage(err) });
      throw err;
    }
  },

  logout: async () => {
    const refreshToken = tokenStorage.getRefreshToken();
    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } catch {
      // Ignore errors — clear anyway
    }
    tokenStorage.clear();
    set({ user: null, error: null });
  },

  logoutAll: async () => {
    try {
      await authApi.logoutAll();
    } catch {
      // Ignore
    }
    tokenStorage.clear();
    set({ user: null, error: null });
  },

  updateProfile: async (updates) => {
    set({ loading: true, error: null });
    try {
      const { user } = await userApi.updateMe(updates);
      set({ user, loading: false });
    } catch (err) {
      set({ loading: false, error: getErrorMessage(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));