/**
 * AI quota hook — fetches and refreshes the current user's AI quota.
 *
 * Uses `clients.ai` from the updated client.ts (port 4003).
 */

import { useState, useEffect, useCallback } from 'react';
import type { AIQuota } from '@/types';
import { clients, getErrorMessage } from '@/api/client';

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
      const { data } = await clients.ai.get<AIQuota>('/quota');
      setQuota(data);
    } catch (err) {
      setError(getErrorMessage(err));
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