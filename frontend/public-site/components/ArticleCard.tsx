/**
 * ArticleCard — card for feed, search, category listings.
 */

import Link from 'next/link';
import { formatRelative } from '@/lib/format';
import type { Post } from '@/lib/types';

interface ArticleCardProps {
  post: Post;
}

export function ArticleCard({ post }: ArticleCardProps) {
  return (
    <Link
      href={`/article/${post.id}`}
      className="group block bg-white rounded-xl border border-slate-200 p-5 hover:shadow-lg transition-shadow"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-semibold">
          {post.authorId.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-xs text-slate-500">
          {formatRelative(post.publishedAt)}
        </div>
      </div>

      <h3 className="font-serif text-xl font-bold text-slate-900 group-hover:text-brand-600 mb-2 line-clamp-2 transition-colors">
        {post.title}
      </h3>

      <p className="text-sm text-slate-600 line-clamp-3 mb-4">
        {post.excerpt}
      </p>

      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span className="capitalize">{post.contentType.replace('_', ' ')}</span>
        <span>·</span>
        <span>{Math.ceil(post.wordCount / 200)} min read</span>
      </div>
    </Link>
  );
}