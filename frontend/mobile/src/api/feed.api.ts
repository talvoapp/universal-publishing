/**
 * Feed API for mobile.
 */

import { apiClient } from './client';
import type { FeedPage } from '@/types';

export const feedApi = {
  getMyFeed: async (cursor?: string, limit = 20): Promise<FeedPage> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const { data } = await apiClient.get<FeedPage>(`/feed?${params.toString()}`);
    return data;
  },
};