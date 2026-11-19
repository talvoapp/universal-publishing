/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_API_URL: string;
  readonly VITE_EDITOR_API_URL: string;
  readonly VITE_AI_API_URL: string;
  readonly VITE_MARKETPLACE_API_URL: string;
  readonly VITE_WALLET_API_URL: string;
  readonly VITE_CONTENT_API_URL: string;
  readonly VITE_FEED_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY: string;
  readonly VITE_APP_ENV: 'development' | 'staging' | 'production';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}