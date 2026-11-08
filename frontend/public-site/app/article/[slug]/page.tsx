/**
 * Article page — preview-only (full content requires purchase).
 *
 * - Server-rendered with `generateMetadata` for SEO
 * - ISR (revalidate 60s)
 * - JSON-LD Article schema
 * - If not found → 404
 * - CTA links to marketplace checkout for full access
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getArticleMetadata, getArticlePreview } from '@/lib/api';
import { buildArticleMetadata, buildArticleJsonLd } from '@/lib/metadata';
import { SEO } from '@/components/SEO';
import { formatDate, formatNumber } from '@/lib/format';

export const revalidate = 60;

interface ArticlePageProps {
  params: { slug: string };
}

// ============================================================
// METADATA
// ============================================================
export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const article = await getArticleMetadata(params.slug);
  if (!article) {
    return { title: 'Article not found' };
  }
  return buildArticleMetadata(article);
}

// ============================================================
// PAGE
// ============================================================
export default async function ArticlePage({ params }: ArticlePageProps) {
  const [metadata, preview] = await Promise.all([
    getArticleMetadata(params.slug),
    getArticlePreview(params.slug),
  ]);

  if (!metadata || !preview) {
    notFound();
  }

  const jsonLd = buildArticleJsonLd(metadata);
  const dashboardUrl = `http://localhost:3000/checkout?item=${metadata.itemId}`;

  return (
    <>
      <SEO jsonLd={jsonLd} />

      <article className="max-w-3xl mx-auto px-4 py-12">
        {/* Breadcrumb */}
        <nav className="mb-8 text-sm text-slate-500">
          <Link href="/" className="hover:text-brand-600">Home</Link>
          <span className="mx-2">/</span>
          <span className="capitalize">{metadata.contentType.replace('_', ' ')}</span>
        </nav>

        {/* Header */}
        <header className="mb-10">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-slate-900 mb-4 leading-tight">
            {metadata.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            {metadata.publishedAt && <span>{formatDate(metadata.publishedAt)}</span>}
            <span>·</span>
            <span>{metadata.readMinutes} min read</span>
            <span>·</span>
            <span>{formatNumber(metadata.wordCount)} words</span>
          </div>
          {metadata.tags && metadata.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {metadata.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/search?q=${encodeURIComponent(tag)}`}
                  className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </header>

        {/* Cover */}
        {metadata.coverImageUrl && (
          <img
            src={metadata.coverImageUrl}
            alt={metadata.title}
            className="w-full rounded-xl mb-10"
          />
        )}

        {/* Preview content */}
        <div className="article-prose">
          {preview.excerpt.split('\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        {/* Paywall CTA */}
        {preview.truncated && (
          <div className="mt-12 p-8 bg-gradient-to-br from-brand-50 to-brand-100 rounded-2xl border border-brand-200 text-center">
            <div className="text-2xl mb-2">🔒</div>
            <h3 className="font-serif text-2xl font-bold text-slate-900 mb-3">
              Continue reading
            </h3>
            <p className="text-slate-600 mb-6 max-w-md mx-auto">
              You've read the preview. Purchase to access the full article
              and support the author.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={dashboardUrl}
                className="inline-flex items-center justify-center bg-brand-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-700"
              >
                Buy full access
              </Link>
              <Link
                href="http://localhost:3000/register"
                className="inline-flex items-center justify-center border border-slate-300 text-slate-700 px-6 py-3 rounded-lg font-medium hover:bg-white"
              >
                Sign up to read
              </Link>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-8 pt-8 border-t border-slate-200">
          <Link
            href="/search"
            className="text-brand-600 hover:text-brand-700 text-sm font-medium"
          >
            ← Browse more articles
          </Link>
        </div>
      </article>
    </>
  );
}