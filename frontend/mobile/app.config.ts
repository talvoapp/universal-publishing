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
      authApiUrl: process.env.EXPO_PUBLIC_AUTH_API_URL || 'http://localhost:4001',
      editorApiUrl: process.env.EXPO_PUBLIC_EDITOR_API_URL || 'http://localhost:4002',
      aiApiUrl: process.env.EXPO_PUBLIC_AI_API_URL || 'http://localhost:4003',
      marketplaceApiUrl: process.env.EXPO_PUBLIC_MARKETPLACE_API_URL || 'http://localhost:4004',
      walletApiUrl: process.env.EXPO_PUBLIC_WALLET_API_URL || 'http://localhost:4005',
      contentApiUrl: process.env.EXPO_PUBLIC_CONTENT_API_URL || 'http://localhost:4006',
      feedApiUrl: process.env.EXPO_PUBLIC_FEED_API_URL || 'http://localhost:4007',
      wsUrl: process.env.EXPO_PUBLIC_WS_URL || 'ws://localhost:4002/editor/stream',
    },
  };
};