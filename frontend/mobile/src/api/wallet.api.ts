/**
 * Wallet API — uses `clients.wallet`.
 */

import { clients } from './client';
import type { WalletSummary } from '@/types';

export const walletApi = {
  getSummary: async (): Promise<WalletSummary> => {
    const { data } = await clients.wallet.get<WalletSummary>('/api/v1/wallet');
    return data;
  },

  requestPayout: async (amountCents: number, currency = 'USD'): Promise<void> => {
    const idempotencyKey = `payout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await clients.wallet.post(
      '/api/v1/wallet/payouts/request',
      { amountCents, currency },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  },
};