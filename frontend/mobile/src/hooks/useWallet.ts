/**
 * useWallet — fetch the user's wallet summary.
 */

import { useState, useEffect, useCallback } from 'react';
import { walletApi } from '@/api/wallet.api';
import { getErrorMessage } from '@/api/client';
import type { WalletSummary } from '@/types';

export function useWallet() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await walletApi.getSummary();
      setWallet(data);
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
    wallet,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
  };
}