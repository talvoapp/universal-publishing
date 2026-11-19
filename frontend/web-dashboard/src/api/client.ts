/**
 * Axios HTTP clients — one per microservice.
 *
 * No API Gateway. Each service has its own port. This file creates
 * one Axios instance per service, with shared interceptors for:
 *   - Bearer token
 *   - Refresh-on-401
 *
 * Usage:
 *   import { clients } from '@/api/client';
 *   await clients.auth.post('/auth/login', ...);
 *   await clients.editor.get('/editor/drafts', ...);
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { APIError, AuthResponse } from '@/types';

// ============================================================
// SERVICE URLS
// ============================================================
const AUTH_URL = import.meta.env.VITE_AUTH_API_URL || 'http://localhost:4001';
const EDITOR_URL = import.meta.env.VITE_EDITOR_API_URL || 'http://localhost:4002';
const AI_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:4003';
const MARKETPLACE_URL = import.meta.env.VITE_MARKETPLACE_API_URL || 'http://localhost:4004';
const WALLET_URL = import.meta.env.VITE_WALLET_API_URL || 'http://localhost:4005';
const CONTENT_URL = import.meta.env.VITE_CONTENT_API_URL || 'http://localhost:4006';
const FEED_URL = import.meta.env.VITE_FEED_API_URL || 'http://localhost:4007';

// ============================================================
// TOKEN STORAGE
// ============================================================
const ACCESS_TOKEN_KEY = 'upp_access_token';
const REFRESH_TOKEN_KEY = 'upp_refresh_token';

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
// SHARED INTERCEPTORS
// ============================================================
let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function attachAuth(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  const token = tokenStorage.getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

async function refreshToken(): Promise<string | null> {
  try {
    const refresh = tokenStorage.getRefreshToken();
    if (!refresh) return null;

    const { data } = await axios.post<AuthResponse>(
      `${AUTH_URL}/api/v1/auth/refresh`,
      { refreshToken: refresh },
      { headers: { 'Content-Type': 'application/json' } },
    );

    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    tokenStorage.clear();
    return null;
  }
}

function createRefreshInterceptor(client: AxiosInstance) {
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<APIError>) => {
      const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

      if (
        error.response?.status === 401 &&
        originalRequest &&
        !originalRequest._retry &&
        !originalRequest.url?.includes('/auth/refresh') &&
        !originalRequest.url?.includes('/auth/login')
      ) {
        if (isRefreshing) {
          return new Promise((resolve) => {
            pendingRequests.push((token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(client(originalRequest));
            });
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const newToken = await refreshToken();
          if (!newToken) throw new Error('Refresh failed');

          pendingRequests.forEach((cb) => cb(newToken));
          pendingRequests = [];

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return client(originalRequest);
        } catch {
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
}

// ============================================================
// FACTORY
// ============================================================
function createClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL: `${baseURL}/api/v1`,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use(attachAuth);
  createRefreshInterceptor(client);
  return client;
}

// ============================================================
// EXPORTS
// ============================================================
export const clients = {
  auth: createClient(AUTH_URL),
  editor: createClient(EDITOR_URL),
  ai: createClient(AI_URL),
  marketplace: createClient(MARKETPLACE_URL),
  wallet: createClient(WALLET_URL),
  content: createClient(CONTENT_URL),
  feed: createClient(FEED_URL),
};

/** Legacy alias — defaults to auth service. */
export const apiClient = clients.auth;

export const API_BASE_URLS = {
  auth: AUTH_URL,
  editor: EDITOR_URL,
  ai: AI_URL,
  marketplace: MARKETPLACE_URL,
  wallet: WALLET_URL,
  content: CONTENT_URL,
  feed: FEED_URL,
} as const;

// ============================================================
// ERROR HELPERS
// ============================================================
export function normalizeError(err: unknown): APIError {
  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<APIError>;
    if (axiosErr.response?.data) return axiosErr.response.data;
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