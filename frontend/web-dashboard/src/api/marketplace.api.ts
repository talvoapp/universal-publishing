/**
 * Marketplace API client.
 */

import { apiClient } from './client';
import type { Item, CheckoutResponse } from '@/types';

export const marketplaceApi = {
  listItems: async (query: {
    type?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ items: Item[]; next_cursor: string }> => {
    const params = new URLSearchParams();
    if (query.type) params.set('type', query.type);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);

    const { data } = await apiClient.get<{ items: Item[]; next_cursor: string }>(
      `/market/items?${params.toString()}`,
    );
    return data;
  },

  getItem: async (id: string): Promise<Item> => {
    const { data } = await apiClient.get<Item>(`/market/items/${id}`);
    return data;
  },

  initiateCheckout: async (
    input: {
      itemId: string;
      chapterIds?: string[];
      successUrl: string;
      cancelUrl: string;
      country?: string;
      state?: string;
      postalCode?: string;
    },
    idempotencyKey: string,
  ): Promise<CheckoutResponse> => {
    const { data } = await apiClient.post<CheckoutResponse>(
      '/market/checkout',
      input,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  confirmCheckout: async (
    checkoutId: string,
    sessionId: string,
  ): Promise<{ order_id: string; status: string; payment_done: boolean }> => {
    const { data } = await apiClient.post(`/market/checkout/${checkoutId}/confirm`, {
      sessionId,
    });
    return data;
  },
};