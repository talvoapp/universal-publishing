/**
 * Root layout — wraps all routes with the navigation container.
 *
 * With expo-router, this file is required at `app/_layout.tsx`.
 */

import { Stack } from 'expo-router';
import { useAuthStore } from '@/store/auth.store';
import { useEffect } from 'react';

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#2563eb' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#f8fafc' },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="editor/[id]" options={{ title: 'Editor' }} />
      <Stack.Screen name="checkout/[itemId]" options={{ title: 'Checkout' }} />
      <Stack.Screen name="payout" options={{ title: 'Request Payout' }} />
    </Stack>
  );
}