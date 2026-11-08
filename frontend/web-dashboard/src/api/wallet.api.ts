/**
 * Wallet API client (author earnings + payouts).
 */

import { apiClient } from './client';
import type { WalletSummary, LedgerEntry, Payout, ConnectStatus, AnalyticsResult } from '@/types';

export const walletApi = {
  getSummary: async (): Promise<WalletSummary> => {
    const { data } = await apiClient.get<WalletSummary>('/wallet');
    return data;
  },

  listLedger: async (cursor?: string, limit = 20): Promise<{ entries: LedgerEntry[]; next_cursor: string }> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const { data } = await apiClient.get<{ entries: LedgerEntry[]; next_cursor: string }>(
      `/wallet/ledger?${params.toString()}`,
    );
    return data;
  },

  requestPayout: async (amountCents: number, currency = 'USD'): Promise<Payout> => {
    const idempotencyKey = `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data } = await apiClient.post<Payout>(
      '/wallet/payouts/request',
      { amountCents, currency },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  listPayouts: async (): Promise<{ payouts: Payout[] }> => {
    const { data } = await apiClient.get<{ payouts: Payout[] }>('/wallet/payouts');
    return data;
  },

  getConnectStatus: async (): Promise<ConnectStatus> => {
    const { data } = await apiClient.get<ConnectStatus>('/wallet/connect/status');
    return data;
  },

  startConnectOnboarding: async (): Promise<{ url: string }> => {
    const { data } = await apiClient.post<{ url: string }>('/wallet/connect/onboard');
    return data;
  },

  getAnalytics: async (period = '30d'): Promise<AnalyticsResult> => {
    const { data } = await apiClient.get<AnalyticsResult>(`/wallet/analytics?period=${period}`);
    return data;
  },
};