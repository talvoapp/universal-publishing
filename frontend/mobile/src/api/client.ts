/**
 * Axios client for mobile.
 *
 * ─── DEPENDENCIES ───
 *   - Only imports `tokenStorage` from `./tokens` (isolated, no cycles)
 *   - Does NOT import from `auth.store` or `auth.api`
 */

import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import { tokenStorage } from './tokens';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080';

// ============================================================
// AXIOS INSTANCE
// ============================================================
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ============================================================
// REQUEST INTERCEPTOR — attach Bearer
// ============================================================
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await tokenStorage.getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ============================================================
// RESPONSE INTERCEPTOR — refresh on 401
// ============================================================
let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      // Another request is already refreshing → queue this one
      if (isRefreshing) {
        return new Promise((resolve) => {
          pendingRequests.push((token: string) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await tokenStorage.getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        // Use axios directly (not apiClient) to avoid interceptor loop
        const { data } = await axios.post(
          `${API_BASE_URL}/api/v1/auth/refresh`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' } },
        );

        await tokenStorage.setTokens(data.accessToken, data.refreshToken);

        // Replay queued requests
        pendingRequests.forEach((cb) => cb(data.accessToken));
        pendingRequests = [];

        // Retry original request
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        // Refresh failed → clear tokens
        await tokenStorage.clear();
        pendingRequests = [];

        // Note: navigation to login is handled by the auth store.
        // The rejected promise propagates so the caller can react.
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ============================================================
// ERROR HELPERS
// ============================================================
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { detail?: string; title?: string }
      | undefined;
    return data?.detail || data?.title || err.message;
  }
  if (err instanceof Error) return err.message;
  return 'An error occurred';
}

export { API_BASE_URL };