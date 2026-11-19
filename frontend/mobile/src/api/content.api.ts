/**
 * Content API — read published content (with entitlements).
 */

import { clients } from './client';

export interface ArticleSummary {
  itemId: string;
  title: string;
  contentType: string;
  language: string;
  wordCount: number;
  readMinutes: number;
  coverImageUrl?: string;
  tags?: string[];
  publishedAt?: string;
}

export interface Preview extends ArticleSummary {
  excerpt: string;
  truncated: boolean;
  previewFraction: number;
  purchaseUrl?: string;
}

export interface FullContent extends ArticleSummary {
  content: string;
  entitlementType: string;
}

export interface ChapterSummary {
  chapterId: string;
  index: number;
  title: string;
  wordCount: number;
  free: boolean;
}

export const contentApi = {
  getMetadata: async (itemId: string): Promise<ArticleSummary> => {
    const { data } = await clients.content.get<ArticleSummary>(
      `/api/v1/content/${itemId}/metadata`,
    );
    return data;
  },

  getPreview: async (itemId: string): Promise<Preview> => {
    const { data } = await clients.content.get<Preview>(
      `/api/v1/content/${itemId}/preview`,
    );
    return data;
  },

  listChapters: async (itemId: string): Promise<{ chapters: ChapterSummary[] }> => {
    const { data } = await clients.content.get<{ chapters: ChapterSummary[] }>(
      `/api/v1/content/${itemId}/chapters`,
    );
    return data;
  },

  readFullItem: async (itemId: string): Promise<FullContent> => {
    const { data } = await clients.content.get<FullContent>(
      `/api/v1/content/${itemId}/read`,
    );
    return data;
  },

  readChapter: async (itemId: string, chapterId: string): Promise<{
    content: string;
    chapterTitle: string;
    entitlementType: string;
  }> => {
    const { data } = await clients.content.get(
      `/api/v1/content/${itemId}/chapters/${chapterId}/read`,
    );
    return data;
  },
};