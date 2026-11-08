/**
 * Convenience hook for auth state + actions.
 */

import { useAuthStore } from '@/store/auth.store';

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const logout = useAuthStore((s) => s.logout);
  const clearError = useAuthStore((s) => s.clearError);

  return {
    user,
    loading,
    error,
    isAuthenticated: isAuthenticated(),
    login,
    register,
    logout,
    clearError,
  };
}