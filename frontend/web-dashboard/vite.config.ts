import { defineConfig } from 'vite';
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
      // Proxy API requests to the gateway
      '/api': {
        target: process.env.VITE_API_BASE_URL || 'http://localhost:8080',
        changeOrigin: true,
      },
      // WebSocket proxy for the editor
      '/editor/stream': {
        target: process.env.VITE_WS_URL?.replace('ws://', 'http://') || 'http://localhost:8080',
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

  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    globals: true,
  },
});