/**
 * Authentication API client.
 */

import { apiClient, tokenStorage } from './client';
import type { AuthResponse, User } from '@/types';
import type { LoginInput, RegisterInput, ForgotPasswordInput, ResetPasswordInput } from '@/utils/validation';

// ============================================================
// AUTH ENDPOINTS
// ============================================================
export const authApi = {
  register: async (input: RegisterInput): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/register', input);
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  login: async (input: LoginInput): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', input);
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  logout: async (refreshToken: string): Promise<void> => {
    try {
      await apiClient.post('/auth/logout', { refreshToken });
    } finally {
      tokenStorage.clear();
    }
  },

  logoutAll: async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout-all');
    } finally {
      tokenStorage.clear();
    }
  },

  forgotPassword: async (input: ForgotPasswordInput): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ message: string }>('/auth/forgot-password', input);
    return data;
  },

  resetPassword: async (input: ResetPasswordInput): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ message: string }>('/auth/reset-password', input);
    return data;
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ message: string }>('/auth/verify-email', { token });
    return data;
  },
};

// ============================================================
// USER ENDPOINTS
// ============================================================
export const userApi = {
  getMe: async (): Promise<{ user: User }> => {
    const { data } = await apiClient.get<{ user: User }>('/users/me');
    return data;
  },

  updateMe: async (updates: Partial<Pick<User, 'displayName' | 'bio' | 'avatarUrl' | 'language'>>): Promise<{ user: User }> => {
    const { data } = await apiClient.patch<{ user: User }>('/users/me', updates);
    return data;
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<{ message: string }> => {
    const { data } = await apiClient.post<{ message: string }>('/users/me/change-password', {
      currentPassword,
      newPassword,
    });
    return data;
  },

  deleteAccount: async (password: string): Promise<{ message: string }> => {
    const { data } = await apiClient.delete<{ message: string }>('/users/me', {
      data: { password, confirmPhrase: 'DELETE MY ACCOUNT' },
    });
    return data;
  },
};