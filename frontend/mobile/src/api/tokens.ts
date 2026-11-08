/**
 * Token storage for mobile — isolated module.
 *
 * WHY IS THIS SEPARATE FROM auth.store.ts?
 *   Because both `client.ts` (Axios interceptors) and `auth.store.ts`
 *   need to read/write tokens. If `client.ts` imported from
 *   `auth.store.ts`, and `auth.store.ts` imported from `auth.api.ts`
 *   (which imports `client.ts`), we'd have a circular dependency.
 *
 *   This module has NO dependencies on other app modules, so it can
 *   be imported from anywhere without risk.
 *
 * WHY SecureStore?
 *   React Native doesn't have localStorage. SecureStore uses:
 *     - iOS: Keychain
 *     - Android: Keystore (encrypted SharedPreferences)
 *   Both are OS-level encrypted storage.
 */

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'upp_access_token';
const REFRESH_TOKEN_KEY = 'upp_refresh_token';

export const tokenStorage = {
  getAccessToken: async (): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  getRefreshToken: async (): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },

  setTokens: async (accessToken: string, refreshToken: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SecureStore] setTokens failed:', err);
    }
  },

  clear: async (): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } catch {
      // ignore
    }
  },
};