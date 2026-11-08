/**
 * Entry redirect — routes to tabs or login based on auth state.
 */

import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';

export default function Index() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!hydrated) return null;

  return <Redirect href={isAuthenticated() ? '/(tabs)' : '/(auth)/login'} />;
}