/**
 * Auth API — uses `clients.auth`.
 */

import { clients } from './client';
import type { AuthResponse, User } from '@/types';

export const authApi = {
  register: async (input: { email: string; password: string; displayName: string }): Promise<AuthResponse> => {
    const { data } = await clients.auth.post<AuthResponse>('/api/v1/auth/register', input);
    return data;
  },

  login: async (input: { email: string; password: string }): Promise<AuthResponse> => {
    const { data } = await clients.auth.post<AuthResponse>('/api/v1/auth/login', input);
    return data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    await clients.auth.post('/api/v1/auth/logout', { refreshToken });
  },
};

export const userApi = {
  getMe: async (): Promise<{ user: User }> => {
    const { data } = await clients.auth.get<{ user: User }>('/api/v1/users/me');
    return data;
  },

  updateMe: async (updates: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl'>>): Promise<{ user: User }> => {
    const { data } = await clients.auth.patch<{ user: User }>('/api/v1/users/me', updates);
    return data;
  },
};