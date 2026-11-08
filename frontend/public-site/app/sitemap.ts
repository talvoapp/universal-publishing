/**
 * Dynamic sitemap — generated from feed.
 */

import type { MetadataRoute } from 'next';
import { getPublicFeed } from '@/lib/api';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/search`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/dmca`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
  ];

  try {
    const feed = await getPublicFeed();
    if (!feed) return staticRoutes;

    const articleRoutes: MetadataRoute.Sitemap = feed.posts.map((post) => ({
      url: `${SITE_URL}/article/${post.id}`,
      lastModified: new Date(post.publishedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));

    return [...staticRoutes, ...articleRoutes];
  } catch {
    return staticRoutes;
  }
}