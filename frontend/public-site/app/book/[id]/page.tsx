/**
 * Book page — cover, TOC, chapters, purchase CTA.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getArticleMetadata, getArticleChapters, getArticlePreview } from '@/lib/api';
import { buildArticleMetadata } from '@/lib/metadata';
import { formatNumber } from '@/lib/format';

export const revalidate = 300;

interface BookPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const metadata = await getArticleMetadata(params.id);
  if (!metadata) return { title: 'Book not found' };
  return buildArticleMetadata(metadata);
}

export default async function BookPage({ params }: BookPageProps) {
  const [metadata, chaptersRes, preview] = await Promise.all([
    getArticleMetadata(params.id),
    getArticleChapters(params.id),
    getArticlePreview(params.id),
  ]);

  if (!metadata || !chaptersRes) {
    notFound();
  }

  const chapters = chaptersRes.chapters;
  const freeChapters = chapters.filter((c) => c.free).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* Header: cover + info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
        {/* Cover */}
        <div className="md:col-span-1">
          <div className="aspect-[2/3] bg-gradient-to-br from-brand-500 to-brand-700 rounded-xl overflow-hidden flex items-center justify-center">
            {metadata.coverImageUrl ? (
              <img
                src={metadata.coverImageUrl}
                alt={metadata.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-white text-center p-6">
                <div className="text-2xl font-bold leading-tight">{metadata.title}</div>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="md:col-span-2">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Book</div>
          <h1 className="font-serif text-4xl font-bold text-slate-900 mb-4">{metadata.title}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500 mb-6">
            <span>{formatNumber(metadata.wordCount)} words</span>
            <span>·</span>
            <span>{metadata.readMinutes} min read</span>
            <span>·</span>
            <span>{chapters.length} chapters</span>
          </div>

          {preview && <p className="text-slate-600 mb-6 line-clamp-4">{preview.excerpt}</p>}

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href={`http://localhost:3000/checkout?item=${metadata.itemId}`}
              className="inline-flex items-center justify-center bg-brand-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-brand-700"
            >
              Buy now
            </Link>
            {freeChapters > 0 && (
              <Link
                href={`/article/${metadata.itemId}`}
                className="inline-flex items-center justify-center border border-slate-300 text-slate-700 px-6 py-3 rounded-lg font-medium hover:bg-slate-50"
              >
                Read {freeChapters} free {freeChapters === 1 ? 'chapter' : 'chapters'}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Table of contents */}
      <section>
        <h2 className="font-serif text-2xl font-bold text-slate-900 mb-6">
          Table of contents
        </h2>
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {chapters.map((chapter) => (
            <div
              key={chapter.chapterId}
              className="flex items-center justify-between px-6 py-4"
            >
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-slate-400 w-8">
                  {chapter.index.toString().padStart(2, '0')}
                </span>
                <div>
                  <div className="font-medium text-slate-900">{chapter.title}</div>
                  <div className="text-xs text-slate-500">
                    {formatNumber(chapter.wordCount)} words
                  </div>
                </div>
              </div>
              {chapter.free ? (
                <span className="text-xs font-medium text-success-600 bg-success-50 px-2 py-1 rounded">
                  Free
                </span>
              ) : (
                <span className="text-xs text-slate-400">🔒</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}