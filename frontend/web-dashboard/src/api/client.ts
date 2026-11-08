/**
 * Axios HTTP client — configured with:
 *   - Base URL from env
 *   - Auth interceptor (adds Bearer token)
 *   - Refresh-token retry (on 401, refresh + retry once)
 *   - Error normalization (RFC 7807 → APIError)
 */

import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { APIError, AuthResponse } from '@/types';

// ============================================================
// CONFIG
// ============================================================
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const ACCESS_TOKEN_KEY = 'upp_access_token';
const REFRESH_TOKEN_KEY = 'upp_refresh_token';

// ============================================================
// TOKEN STORAGE
// ============================================================
export const tokenStorage = {
  getAccessToken: (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY),
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),
  setTokens: (accessToken: string, refreshToken: string): void => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear: (): void => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// ============================================================
// AXIOS INSTANCE
// ============================================================
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ============================================================
// REQUEST INTERCEPTOR — attach Bearer token
// ============================================================
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ============================================================
// RESPONSE INTERCEPTOR — refresh on 401
// ============================================================
let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<APIError>) => {
    const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    // If 401 and not already retried → try refreshing
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      if (isRefreshing) {
        // Queue this request until refresh completes
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
        const refreshToken = tokenStorage.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        // Call refresh endpoint (bypassing interceptor to avoid loops)
        const { data } = await axios.post<AuthResponse>(
          `${API_BASE_URL}/api/v1/auth/refresh`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' } },
        );

        tokenStorage.setTokens(data.accessToken, data.refreshToken);
        pendingRequests.forEach((cb) => cb(data.accessToken));
        pendingRequests = [];

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        }
        return apiClient(originalRequest);
      } catch {
        // Refresh failed — clear tokens + redirect to login
        tokenStorage.clear();
        pendingRequests = [];
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

// ============================================================
// ERROR NORMALIZATION
// ============================================================
export function normalizeError(err: unknown): APIError {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<APIError>;
    if (axiosErr.response?.data) {
      return axiosErr.response.data;
    }
    return {
      type: 'https://httpstatuses.io/500',
      title: 'Network Error',
      status: axiosErr.response?.status ?? 0,
      detail: axiosErr.message,
    };
  }

  if (err instanceof Error) {
    return {
      type: 'https://httpstatuses.io/500',
      title: 'Client Error',
      status: 0,
      detail: err.message,
    };
  }

  return {
    type: 'https://httpstatuses.io/500',
    title: 'Unknown Error',
    status: 0,
    detail: 'An unknown error occurred',
  };
}

export function getErrorMessage(err: unknown): string {
  const apiErr = normalizeError(err);
  return apiErr.detail || apiErr.title || 'An error occurred';
}