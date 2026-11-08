/**
 * Editor API for mobile — mirrors web-dashboard but trimmed.
 */

import { apiClient } from './client';
import type { Draft, DraftSummary } from '@/types';

export const editorApi = {
  listDrafts: async (query: {
    status?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<{ data: DraftSummary[]; next_cursor: string | null }> => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));

    const { data } = await apiClient.get<{
      data: DraftSummary[];
      next_cursor: string | null;
    }>(`/editor/drafts?${params.toString()}`);
    return data;
  },

  getDraft: async (id: string): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.get<{ draft: Draft }>(`/editor/drafts/${id}`);
    return data;
  },

  createDraft: async (input: {
    title?: string;
    contentType: 'article' | 'book' | 'news_post';
  }): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.post<{ draft: Draft }>('/editor/drafts', input);
    return data;
  },

  updateDraft: async (
    id: string,
    input: { title?: string; language?: string },
  ): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.patch<{ draft: Draft }>(
      `/editor/drafts/${id}`,
      input,
    );
    return data;
  },

  deleteDraft: async (id: string): Promise<void> => {
    await apiClient.delete(`/editor/drafts/${id}`);
  },

  publishDraft: async (id: string): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.post<{ draft: Draft }>(
      `/editor/drafts/${id}/publish`,
    );
    return data;
  },
};