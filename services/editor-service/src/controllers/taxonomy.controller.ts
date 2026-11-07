/**
 * Taxonomy controller — public read-only endpoints.
 */

import type { Request, Response } from 'express';
import * as taxonomyService from '@/services/taxonomy.service';

// ============================================================
// CATEGORIES
// ============================================================
export async function listCategories(_req: Request, res: Response): Promise<void> {
  const categories = await taxonomyService.listCategories();
  // Cache for 1h — categories change rarely
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ categories });
}

// ============================================================
// TAGS AUTOCOMPLETE
// ============================================================
export async function searchTags(req: Request, res: Response): Promise<void> {
  const { q, limit } = req.query as unknown as { q: string; limit: number };
  const tags = await taxonomyService.searchTags({ q, limit });
  // Cache for 5m — tags change more frequently
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ tags });
}