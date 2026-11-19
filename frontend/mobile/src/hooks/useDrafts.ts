/**
 * useDrafts — list the user's drafts.
 */

import { useState, useEffect, useCallback } from 'react';
import { editorApi } from '@/api/editor.api';
import { getErrorMessage } from '@/api/client';
import type { DraftSummary } from '@/types';

export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const { data } = await editorApi.listDrafts({ limit: 50 });
      setDrafts(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    drafts,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
  };
}