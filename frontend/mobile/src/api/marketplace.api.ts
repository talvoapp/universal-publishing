/**
 * Marketplace API — uses `clients.marketplace`.
 */

import { clients } from './client';
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

    const { data } = await clients.marketplace.get<{ items: Item[]; next_cursor: string }>(
      `/api/v1/market/items?${params.toString()}`,
    );
    return data;
  },

  getItem: async (id: string): Promise<Item> => {
    const { data } = await clients.marketplace.get<Item>(`/api/v1/market/items/${id}`);
    return data;
  },

  initiateCheckout: async (input: {
    itemId: string;
    successUrl: string;
    cancelUrl: string;
    chapterIds?: string[];
  }): Promise<{ checkout_url: string; order_id: string }> => {
    const idempotencyKey = `checkout-${input.itemId}-${Date.now()}`;
    const { data } = await clients.marketplace.post<{ checkout_url: string; order_id: string }>(
      '/api/v1/market/checkout',
      input,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },
};