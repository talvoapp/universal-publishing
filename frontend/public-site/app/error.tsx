/**
 * Global error boundary.
 */

'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Public site error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">Something went wrong</h1>
        <p className="text-slate-600 mb-6">
          We couldn't load this page. Please try again.
        </p>
        <button
          onClick={reset}
          className="bg-brand-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-700 transition"
        >
          Try again
        </button>
      </div>
    </div>
  );
}