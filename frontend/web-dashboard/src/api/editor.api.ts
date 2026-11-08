/**
 * Editor API client (HTTP only — content via WebSocket).
 */

import { apiClient } from './client';
import type { Draft, DraftSummary, VersionEntry, Chapter } from '@/types';
import type { CreateDraftInput, UpdateDraftInput } from '@/utils/validation';

// ============================================================
// DRAFTS
// ============================================================
export const editorApi = {
  createDraft: async (input: CreateDraftInput): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.post<{ draft: Draft }>('/editor/drafts', input);
    return data;
  },

  listDrafts: async (query: {
    status?: string;
    contentType?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<{ data: DraftSummary[]; next_cursor: string | null }> => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.contentType) params.set('contentType', query.contentType);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));

    const { data } = await apiClient.get<{ data: DraftSummary[]; next_cursor: string | null }>(
      `/editor/drafts?${params.toString()}`,
    );
    return data;
  },

  getDraft: async (id: string): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.get<{ draft: Draft }>(`/editor/drafts/${id}`);
    return data;
  },

  updateDraft: async (
    id: string,
    input: UpdateDraftInput,
    expectedVersion?: number,
  ): Promise<{ draft: Draft }> => {
    const headers = expectedVersion !== undefined ? { 'If-Match': String(expectedVersion) } : {};
    const { data } = await apiClient.patch<{ draft: Draft }>(`/editor/drafts/${id}`, input, { headers });
    return data;
  },

  deleteDraft: async (id: string): Promise<void> => {
    await apiClient.delete(`/editor/drafts/${id}`);
  },

  publishDraft: async (id: string): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.post<{ draft: Draft }>(`/editor/drafts/${id}/publish`);
    return data;
  },

  forceSnapshot: async (id: string): Promise<{ version: number; snapshot_at: string }> => {
    const { data } = await apiClient.post<{ version: number; snapshot_at: string }>(
      `/editor/drafts/${id}/snapshot`,
    );
    return data;
  },

  // ============================================================
  // TAGS
  // ============================================================
  addTags: async (id: string, tags: string[]): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.post<{ draft: Draft }>(`/editor/drafts/${id}/tags`, { tags });
    return data;
  },

  removeTag: async (id: string, tag: string): Promise<{ draft: Draft }> => {
    const { data } = await apiClient.delete<{ draft: Draft }>(
      `/editor/drafts/${id}/tags/${encodeURIComponent(tag)}`,
    );
    return data;
  },
};

// ============================================================
// VERSIONS
// ============================================================
export const versionApi = {
  listVersions: async (
    draftId: string,
    cursor?: string,
    limit = 20,
  ): Promise<{ data: VersionEntry[]; next_cursor: string | null }> => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    const { data } = await apiClient.get<{ data: VersionEntry[]; next_cursor: string | null }>(
      `/versions/drafts/${draftId}?${params.toString()}`,
    );
    return data;
  },

  getVersion: async (
    draftId: string,
    version: number,
  ): Promise<{ version: number; content: string; metadata: Record<string, unknown>; createdAt: string; createdBy: string }> => {
    const { data } = await apiClient.get(`/versions/drafts/${draftId}/${version}`);
    return data;
  },

  revertToVersion: async (draftId: string, toVersion: number): Promise<{ draft: Draft; new_version: number }> => {
    const { data } = await apiClient.post<{ draft: Draft; new_version: number }>(
      `/versions/drafts/${draftId}/revert`,
      { to_version: toVersion },
    );
    return data;
  },
};

// ============================================================
// TAXONOMY (public)
// ============================================================
export const taxonomyApi = {
  listCategories: async (): Promise<{ categories: Array<{ slug: string; name: string; children?: Array<{ slug: string; name: string }> }> }> => {
    const { data } = await apiClient.get('/taxonomy/categories');
    return data;
  },

  searchTags: async (q: string, limit = 10): Promise<{ tags: Array<{ tag: string; count: number }> }> => {
    const { data } = await apiClient.get(`/taxonomy/tags?q=${encodeURIComponent(q)}&limit=${limit}`);
    return data;
  },
};

// ============================================================
// CONTENT (chapters TOC)
// ============================================================
export const contentApi = {
  getMetadata: async (itemId: string): Promise<{ itemId: string; title: string; contentType: string; wordCount: number; coverImageUrl?: string; tags?: string[] }> => {
    const { data } = await apiClient.get(`/content/${itemId}/metadata`);
    return data;
  },

  listChapters: async (itemId: string): Promise<{ itemId: string; title: string; chapters: Chapter[] }> => {
    const { data } = await apiClient.get<{ itemId: string; title: string; chapters: Chapter[] }>(
      `/content/${itemId}/chapters`,
    );
    return data;
  },

  getPreview: async (itemId: string): Promise<{ itemId: string; title: string; excerpt: string; truncated: boolean; purchaseUrl?: string }> => {
    const { data } = await apiClient.get(`/content/${itemId}/preview`);
    return data;
  },
};