/**
 * AI quota hook — fetches and refreshes the current user's AI quota.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AIQuota } from '@/types';
import { aiApi } from '@/api/ai.api';

interface UseQuotaReturn {
  quota: AIQuota | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useQuota(): UseQuotaReturn {
  const [quota, setQuota] = useState<AIQuota | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiApi.getQuota();
      setQuota(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quota');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    // Refresh every 60s (quota resets daily but usage changes)
    const interval = setInterval(() => {
      void refresh();
    }, 60_000);

    return () => clearInterval(interval);
  }, [refresh]);

  return { quota, loading, error, refresh };
}