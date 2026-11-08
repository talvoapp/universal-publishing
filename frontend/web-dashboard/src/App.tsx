/**
 * Root App component.
 *
 * Provides:
 *   - ErrorBoundary (catches rendering errors)
 *   - Router (from router.tsx)
 *   - Auth hydration (loads /users/me on mount if token exists)
 */

import React, { useEffect } from 'react';
import { Router } from './router';
import { useAuthStore } from './store/auth.store';
import { tokenStorage } from './api/client';

// ============================================================
// ERROR BOUNDARY
// ============================================================
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-bold mb-4 text-slate-900">
              Something went wrong
            </h1>
            <p className="text-slate-600 mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-brand-600 text-white px-6 py-2 rounded-lg hover:bg-brand-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// APP
// ============================================================
export default function App(): JSX.Element {
  const hydrateAuth = useAuthStore((s) => s.hydrate);
  const hydrated = useAuthStore((s) => s.hydrated);

  useEffect(() => {
    // If we have a token, load the user immediately
    if (tokenStorage.getAccessToken()) {
      void hydrateAuth();
    } else {
      useAuthStore.setState({ hydrated: true });
    }
  }, [hydrateAuth]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Router />
    </ErrorBoundary>
  );
}