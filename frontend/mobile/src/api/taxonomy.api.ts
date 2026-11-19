/**
 * Taxonomy API — categories and tag autocomplete.
 */

import { clients } from './client';

export interface CategoryNode {
  slug: string;
  name: string;
  children?: CategoryNode[];
}

export const taxonomyApi = {
  listCategories: async (): Promise<{ categories: CategoryNode[] }> => {
    const { data } = await clients.editor.get<{ categories: CategoryNode[] }>(
      '/api/v1/taxonomy/categories',
    );
    return data;
  },

  searchTags: async (q: string, limit = 10): Promise<{ tags: { tag: string; count: number }[] }> => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    const { data } = await clients.editor.get<{ tags: { tag: string; count: number }[] }>(
      `/api/v1/taxonomy/tags?${params.toString()}`,
    );
    return data;
  },
};