/**
 * Vite + Vitest configuration.
 *
 * Uses `defineConfig` from `vitest/config` (not `vite`) so that the
 * `test` field is recognized by TypeScript. Vitest extends Vite's
 * config with a `test` namespace.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      '/editor/stream': {
        target:
          process.env.VITE_WS_URL?.replace('ws://', 'http://') ||
          'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          editor: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/pm'],
          charts: ['recharts'],
        },
      },
    },
  },

  // ============================================================
  // VITEST CONFIG
  // ============================================================
  test: {
    // Use jsdom for DOM APIs (window, document)
    environment: 'jsdom',

    // Global test utilities (describe, it, expect) without imports
    globals: true,

    // Setup file runs before each test file
    setupFiles: ['./tests/setup.ts'],

    // Test file patterns
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],

    // Ignore build output
    exclude: ['node_modules', 'dist'],

    // Coverage (optional — run with `--coverage`)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'tests', '**/*.d.ts', 'src/main.tsx'],
    },
  },
});