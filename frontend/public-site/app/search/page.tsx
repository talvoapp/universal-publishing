/**
 * Search page — filters the feed by query string.
 *
 * Uses a server component to fetch the feed, then filters on the server.
 * In v2, this will call a dedicated /search endpoint on the backend
 * with full-text search + pagination.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicFeed } from '@/lib/api';
import { ArticleCard } from '@/components/ArticleCard';

export const revalidate = 30;

interface SearchPageProps {
  searchParams: { q?: string };
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const q = searchParams.q?.trim();
  return {
    title: q ? `Search: ${q}` : 'Search',
    description: 'Search articles, books, and authors on Universal Publishing.',
    robots: {
      // Don't index search result pages (thin content)
      index: false,
      follow: true,
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const q = searchParams.q?.trim().toLowerCase() ?? '';
  const feed = await getPublicFeed();

  // Filter posts by title, excerpt, tags
  const results = !q
    ? []
    : feed?.posts.filter((post) => {
        const haystack = [
          post.title,
          post.excerpt,
          ...(post.tags ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      }) ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-serif text-4xl font-bold text-slate-900 mb-2">
          {q ? `Search results for "${q}"` : 'Search'}
        </h1>
        <p className="text-slate-600">
          {q
            ? `${results.length} ${results.length === 1 ? 'result' : 'results'} found`
            : 'Enter a query in the search bar above to find articles, books, and authors.'}
        </p>
      </div>

      {/* Search form (also available in navbar) */}
      <form action="/search" method="GET" className="mb-10">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search articles, books, authors…"
            className="flex-1 px-4 py-3 text-base bg-white border border-slate-300 rounded-lg focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            type="submit"
            className="px-6 py-3 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700"
          >
            Search
          </button>
        </div>
      </form>

      {/* Results */}
      {q && results.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔍</div>
          <h2 className="font-semibold text-xl text-slate-900 mb-2">No results found</h2>
          <p className="text-slate-600 mb-6">
            We couldn't find anything matching "{q}".
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium"
          >
            ← Back to home
          </Link>
        </div>
      ) : q ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {results.map((post) => (
            <ArticleCard key={post.id} post={post} />
          ))}
        </div>
      ) : null}
    </div>
  );
}