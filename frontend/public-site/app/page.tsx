/**
 * Homepage — featured articles + recent feed.
 */

import Link from 'next/link';
import { getPublicFeed } from '@/lib/api';
import { ArticleCard } from '@/components/ArticleCard';

export const revalidate = 60; // ISR: regenerate every 60s

export default async function HomePage() {
  const feed = await getPublicFeed();

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Hero */}
      <section className="text-center py-16 mb-12">
        <h1 className="text-5xl md:text-6xl font-bold text-slate-900 mb-6 leading-tight">
          Read, write, and publish <span className="text-brand-600">beautifully</span>.
        </h1>
        <p className="text-xl text-slate-600 max-w-2xl mx-auto mb-8">
          A modern platform for authors and readers. Discover new voices, publish
          your work, and get paid for your writing.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/search"
            className="inline-flex items-center gap-2 bg-brand-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-700 transition"
          >
            Explore content
          </Link>
          <Link
            href="http://localhost:3000/register"
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 px-6 py-3 rounded-lg font-medium hover:bg-slate-50 transition"
          >
            Start writing
          </Link>
        </div>
      </section>

      {/* Feed */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-3xl font-bold text-slate-900">Recently published</h2>
          <Link href="/search" className="text-brand-600 hover:text-brand-700 text-sm font-medium">
            See all →
          </Link>
        </div>

        {!feed || feed.posts.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            <p className="text-lg mb-2">No articles yet.</p>
            <p className="text-sm">Be the first to publish!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {feed.posts.slice(0, 9).map((post) => (
              <ArticleCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}