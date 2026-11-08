/**
 * Feed API client.
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

  getUserFeed: async (userId: string, cursor?: string): Promise<FeedPage> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const { data } = await apiClient.get<FeedPage>(`/feed/user/${userId}?${params.toString()}`);
    return data;
  },

  getAuthorPosts: async (authorId: string, limit = 20): Promise<{ authorId: string; posts: Array<{ id: string; score: number; publishedAt: number }> }> => {
    const { data } = await apiClient.get(`/feed/author/${authorId}?limit=${limit}`);
    return data;
  },

  follow: async (userId: string): Promise<void> => {
    await apiClient.post(`/follow/${userId}`);
  },

  unfollow: async (userId: string): Promise<void> => {
    await apiClient.delete(`/follow/${userId}`);
  },

  listFollowers: async (): Promise<{ followers: Array<{ userId: string; followedAt: string }>; count: number }> => {
    const { data } = await apiClient.get('/follow/followers');
    return data;
  },

  listFollowing: async (): Promise<{ following: Array<{ userId: string; followedAt: string }>; count: number }> => {
    const { data } = await apiClient.get('/follow/following');
    return data;
  },
};