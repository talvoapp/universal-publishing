/**
 * Category listing — filtered feed by tag/category.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicFeed } from '@/lib/api';
import { ArticleCard } from '@/components/ArticleCard';

export const revalidate = 60;

interface CategoryPageProps {
  params: { slug: string };
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const category = params.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    title: `${category} articles`,
    description: `Browse articles in the ${category} category.`,
  };
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const feed = await getPublicFeed();
  const category = params.slug.toLowerCase();

  // Filter posts that have the category as a tag
  const posts = feed?.posts.filter(
    (p) => p.tags?.some((t) => t.toLowerCase() === category) ?? false,
  ) ?? [];

  const displayCategory = params.slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-slate-500">
        <Link href="/" className="hover:text-brand-600">Home</Link>
        <span className="mx-2">/</span>
        <span>Category</span>
        <span className="mx-2">/</span>
        <span className="text-slate-900">{displayCategory}</span>
      </nav>

      {/* Header */}
      <div className="mb-12">
        <h1 className="font-serif text-4xl font-bold text-slate-900 mb-2">
          {displayCategory}
        </h1>
        <p className="text-slate-600">
          {posts.length} {posts.length === 1 ? 'article' : 'articles'} in this category
        </p>
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          No articles in this category yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <ArticleCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}