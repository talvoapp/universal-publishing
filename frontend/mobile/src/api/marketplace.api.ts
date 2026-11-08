/**
 * Marketplace API for mobile.
 *
 * Note: checkout on mobile requires a WebView or deep linking to Stripe.
 * In v1 we return the checkout URL and open it via Linking.openURL().
 */

import { apiClient } from './client';
import type { Item } from '@/types';

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

  initiateCheckout: async (input: {
    itemId: string;
    successUrl: string;
    cancelUrl: string;
    chapterIds?: string[];
  }): Promise<{ checkout_url: string; order_id: string }> => {
    const idempotencyKey = `checkout-${input.itemId}-${Date.now()}`;
    const { data } = await apiClient.post<{ checkout_url: string; order_id: string }>(
      '/market/checkout',
      input,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },
};