/**
 * Axios clients for mobile — one per microservice.
 *
 * WHY ONE CLIENT PER SERVICE?
 *   We don't have an API Gateway (no Nginx / Express router).
 *   Each microservice runs on its own port. We must send requests
 *   to the correct service based on the URL path:
 *
 *     /auth/*        → auth-service        (4001)
 *     /users/*       → auth-service        (4001)
 *     /oauth/*       → auth-service        (4001)
 *     /editor/*      → editor-service      (4002)
 *     /versions/*    → editor-service      (4002)
 *     /taxonomy/*    → editor-service      (4002)
 *     /ai/*          → ai-service          (4003)
 *     /quota/*       → ai-service          (4003)
 *     /market/*      → marketplace-service (4004)
 *     /wallet/*      → wallet-service      (4005)
 *     /content/*     → content-service     (4006)
 *     /feed/*        → feed-service        (4007)
 *     /follow/*      → feed-service        (4007)
 *
 * This file creates one Axios instance per service, each with:
 *   - The correct baseURL
 *   - The auth interceptor (attach Bearer token)
 *   - The refresh-on-401 interceptor
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
import { tokenStorage } from './tokens';

// ============================================================
// SERVICE URLS
// ============================================================
const AUTH_URL = process.env.EXPO_PUBLIC_AUTH_API_URL || 'http://localhost:4001';
const EDITOR_URL = process.env.EXPO_PUBLIC_EDITOR_API_URL || 'http://localhost:4002';
const AI_URL = process.env.EXPO_PUBLIC_AI_API_URL || 'http://localhost:4003';
const MARKETPLACE_URL = process.env.EXPO_PUBLIC_MARKETPLACE_API_URL || 'http://localhost:4004';
const WALLET_URL = process.env.EXPO_PUBLIC_WALLET_API_URL || 'http://localhost:4005';
const CONTENT_URL = process.env.EXPO_PUBLIC_CONTENT_API_URL || 'http://localhost:4006';
const FEED_URL = process.env.EXPO_PUBLIC_FEED_API_URL || 'http://localhost:4007';

// ============================================================
// SHARED INTERCEPTORS
// ============================================================
async function attachAuth(config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> {
  const token = await tokenStorage.getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function handleRefresh(
  error: AxiosError,
  refreshFn: () => Promise<string | null>,
): Promise<unknown> {
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
    if (isRefreshing) {
      return new Promise((resolve) => {
        pendingRequests.push((token: string) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          resolve(refreshFn().then(() => originalRequest));
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    return refreshFn()
      .then((newToken) => {
        if (!newToken) throw new Error('No refresh token');
        pendingRequests.forEach((cb) => cb(newToken));
        pendingRequests = [];
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return axios(originalRequest);
      })
      .catch((err) => {
        pendingRequests = [];
        return Promise.reject(err);
      })
      .finally(() => {
        isRefreshing = false;
      });
  }

  return Promise.reject(error);
}

// ============================================================
// TOKEN REFRESH (shared)
// ============================================================
async function refreshToken(): Promise<string | null> {
  try {
    const refresh = await tokenStorage.getRefreshToken();
    if (!refresh) return null;

    const { data } = await axios.post(
      `${AUTH_URL}/api/v1/auth/refresh`,
      { refreshToken: refresh },
      { headers: { 'Content-Type': 'application/json' } },
    );

    await tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken as string;
  } catch {
    await tokenStorage.clear();
    return null;
  }
}

// ============================================================
// FACTORY
// ============================================================
function createClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use(attachAuth, (err) => Promise.reject(err));
  client.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => handleRefresh(error, refreshToken),
  );

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

/**
 * Backward-compatible `apiClient` — defaults to auth-service.
 * Prefer using `clients.auth`, `clients.editor`, etc.
 */
export const apiClient = clients.auth;

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

// ============================================================
// SERVICE URL EXPORTS
// ============================================================
export const API_BASE_URLS = {
  auth: AUTH_URL,
  editor: EDITOR_URL,
  ai: AI_URL,
  marketplace: MARKETPLACE_URL,
  wallet: WALLET_URL,
  content: CONTENT_URL,
  feed: FEED_URL,
} as const;