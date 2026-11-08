/**
 * Wallet API for mobile.
 */

import { apiClient } from './client';
import type { WalletSummary } from '@/types';

export const walletApi = {
  getSummary: async (): Promise<WalletSummary> => {
    const { data } = await apiClient.get<WalletSummary>('/wallet');
    return data;
  },

  requestPayout: async (amountCents: number, currency = 'USD'): Promise<void> => {
    const idempotencyKey = `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await apiClient.post(
      '/wallet/payouts/request',
      { amountCents, currency },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  },
};