/**
 * Author profile page — bio + their published posts.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublicFeed } from '@/lib/api';
import { ArticleCard } from '@/components/ArticleCard';

export const revalidate = 120;

interface AuthorPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: AuthorPageProps): Promise<Metadata> {
  return {
    title: `Author · ${params.id.slice(0, 8)}`,
  };
}

export default async function AuthorPage({ params }: AuthorPageProps) {
  // In v2, we'd fetch author profile from auth-service.
  // For now, we display what we can from the feed.
  const feed = await getPublicFeed();
  const posts = feed?.posts.filter((p) => p.authorId === params.id) ?? [];

  if (!feed) {
    notFound();
  }

  // Placeholder author info (v2: fetch from users API)
  const displayName = `Author ${params.id.slice(0, 8)}`;

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex items-center gap-6 mb-12">
        <div className="w-24 h-24 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-3xl font-bold flex-shrink-0">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="font-serif text-3xl font-bold text-slate-900">{displayName}</h1>
          <p className="text-slate-600 mt-1">
            {posts.length} {posts.length === 1 ? 'post' : 'posts'} published
          </p>
        </div>
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          This author hasn't published any posts yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {posts.map((post) => (
            <ArticleCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}