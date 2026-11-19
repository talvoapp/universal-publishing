/**
 * Feed API — uses `clients.feed`.
 */

import { clients } from './client';
import type { FeedPage } from '@/types';

export const feedApi = {
  getMyFeed: async (cursor?: string, limit = 20): Promise<FeedPage> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const { data } = await clients.feed.get<FeedPage>(`/api/v1/feed?${params.toString()}`);
    return data;
  },
};