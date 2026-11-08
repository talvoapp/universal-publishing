/**
 * Expo config — dynamic based on environment.
 *
 * - Dev: allows HTTP (for localhost API)
 * - Production: HTTPS only
 *
 * Docs: https://docs.expo.dev/workflow/configuration/
 */

import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const isDev = process.env.APP_ENV !== 'production';

  return {
    ...config,
    name: 'Universal Publishing',
    slug: 'upp-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    scheme: 'upp',
    userInterfaceStyle: 'automatic',

    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#2563eb',
    },

    assetBundlePatterns: ['**/*'],

    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.upp.mobile',
      ...(isDev
        ? {
            infoPlist: {
              NSAppTransportSecurity: {
                NSAllowsArbitraryLoads: true,
              },
            },
          }
        : {}),
    },

    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#2563eb',
      },
      package: 'com.upp.mobile',
      ...(isDev ? { usesCleartextTraffic: true } : {}),
    },

    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },

    plugins: ['expo-router', 'expo-secure-store'],

    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8080',
      wsUrl: process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:8080/editor/stream',
    },
  };
};