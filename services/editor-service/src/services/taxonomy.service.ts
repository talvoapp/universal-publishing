/**
 * Taxonomy service — categories & tag search.
 *
 * Categories are STATIC (defined in code) for v1. In the future they
 * could live in MongoDB with an admin UI. Tag search queries the
 * `drafts.metadata.tags` field across published drafts.
 *
 * Both are cached (Redis + response Cache-Control) since they change
 * rarely relative to read volume.
 */

import { DraftModel } from '@/models/Draft.model';
import { createLogger } from '@/utils/logger';

const log = createLogger('taxonomy.service');

// ============================================================
// STATIC CATEGORIES
// ============================================================
/**
 * Fixed taxonomy — hierarchical. The client renders this as a tree.
 * Adding a category is a code change; there is no runtime mutation.
 */
const CATEGORIES = [
  {
    slug: 'fiction',
    name: 'Fiction',
    children: [
      { slug: 'fiction.literary', name: 'Literary Fiction' },
      { slug: 'fiction.sci-fi', name: 'Science Fiction' },
      { slug: 'fiction.fantasy', name: 'Fantasy' },
      { slug: 'fiction.mystery', name: 'Mystery & Thriller' },
      { slug: 'fiction.romance', name: 'Romance' },
      { slug: 'fiction.historical', name: 'Historical Fiction' },
    ],
  },
  {
    slug: 'nonfiction',
    name: 'Non-Fiction',
    children: [
      { slug: 'nonfiction.biography', name: 'Biography & Memoir' },
      { slug: 'nonfiction.business', name: 'Business & Economics' },
      { slug: 'nonfiction.self-help', name: 'Self-Help' },
      { slug: 'nonfiction.science', name: 'Science & Technology' },
      { slug: 'nonfiction.history', name: 'History' },
      { slug: 'nonfiction.philosophy', name: 'Philosophy' },
    ],
  },
  {
    slug: 'poetry',
    name: 'Poetry',
    children: [
      { slug: 'poetry.classical', name: 'Classical' },
      { slug: 'poetry.modern', name: 'Modern & Contemporary' },
    ],
  },
  {
    slug: 'journalism',
    name: 'Journalism',
    children: [
      { slug: 'journalism.news', name: 'News' },
      { slug: 'journalism.opinion', name: 'Opinion & Editorial' },
      { slug: 'journalism.investigation', name: 'Investigative' },
      { slug: 'journalism.feature', name: 'Feature Stories' },
    ],
  },
  {
    slug: 'children',
    name: "Children's",
    children: [
      { slug: 'children.picture', name: 'Picture Books' },
      { slug: 'children.middle-grade', name: 'Middle Grade' },
      { slug: 'children.ya', name: 'Young Adult' },
    ],
  },
  {
    slug: 'academic',
    name: 'Academic',
    children: [
      { slug: 'academic.textbook', name: 'Textbooks' },
      { slug: 'academic.journal', name: 'Journals & Papers' },
    ],
  },
] as const;

// ============================================================
// LIST CATEGORIES
// ============================================================
export interface CategoryNode {
  slug: string;
  name: string;
  children?: CategoryNode[];
}

export async function listCategories(): Promise<CategoryNode[]> {
  // Static — no DB hit. Just return the tree.
  return CATEGORIES.map((c) => ({
    slug: c.slug,
    name: c.name,
    children: c.children.map((ch) => ({ slug: ch.slug, name: ch.name })),
  }));
}

// ============================================================
// SEARCH TAGS
// ============================================================
/**
 * Returns tags matching the query prefix or containing the substring.
 * Queries `drafts.metadata.tags` across PUBLISHED drafts only.
 *
 * Implementation:
 *   - `$unwind` the tags array
 *   - `$match` by regex (case-insensitive, escaped)
 *   - `$group` to dedupe with counts
 *   - `$sort` by count desc
 *   - `$limit`
 *
 * Regex escaping prevents ReDoS (user input goes through `escapeRegex`).
 */
export async function searchTags(input: {
  q: string;
  limit: number;
}): Promise<{ tag: string; count: number }[]> {
  const safeQuery = escapeRegex(input.q.trim());
  if (!safeQuery) return [];

  const results = await DraftModel.aggregate<{ _id: string; count: number }>([
    { $match: { status: 'published', deletedAt: null } },
    { $unwind: '$metadata.tags' },
    { $match: { 'metadata.tags': { $regex: safeQuery, $options: 'i' } } },
    { $group: { _id: '$metadata.tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: input.limit },
  ]);

  return results.map((r) => ({ tag: r._id, count: r.count }));
}

// ============================================================
// HELPERS
// ============================================================
/**
 * Escape regex metacharacters so user input cannot inject a ReDoS
 * pattern. Also limits the length to prevent pathological inputs.
 */
function escapeRegex(input: string): string {
  const trimmed = input.slice(0, 50);
  return trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}