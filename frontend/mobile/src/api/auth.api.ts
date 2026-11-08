/**
 * Auth API — same as web but with SecureStore.
 */

import { apiClient } from './client';
import type { AuthResponse, User } from '@/types';

export const authApi = {
  register: async (input: { email: string; password: string; displayName: string }): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/register', input);
    return data;
  },

  login: async (input: { email: string; password: string }): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', input);
    return data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post('/auth/logout', { refreshToken });
  },
};

export const userApi = {
  getMe: async (): Promise<{ user: User }> => {
    const { data } = await apiClient.get<{ user: User }>('/users/me');
    return data;
  },

  updateMe: async (updates: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl'>>): Promise<{ user: User }> => {
    const { data } = await apiClient.patch<{ user: User }>('/users/me', updates);
    return data;
  },
};