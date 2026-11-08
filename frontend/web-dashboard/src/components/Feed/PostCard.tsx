/**
 * PostCard — displays a post in the feed.
 */

import { Link } from 'react-router-dom';
import { formatRelative, truncate } from '@/utils/format';
import type { Post } from '@/types';

interface PostCardProps {
  post: Post;
}

export function PostCard({ post }: PostCardProps) {
  return (
    <Link
      to={`/article/${post.id}`}
      className="block bg-white rounded-xl border border-slate-200 p-5 hover:shadow-card-hover transition-shadow"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-sm font-semibold flex-shrink-0">
          {post.authorId.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 truncate">
            Author {post.authorId.slice(0, 8)}
          </div>
          <div className="text-xs text-slate-500">{formatRelative(post.publishedAt)}</div>
        </div>
      </div>

      <h3 className="font-semibold text-lg text-slate-900 mb-2 line-clamp-2">{post.title}</h3>
      <p className="text-sm text-slate-600 line-clamp-3">{truncate(post.excerpt, 200)}</p>

      <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
        <span>{post.contentType.replace('_', ' ')}</span>
        {post.wordCount > 0 && <span>· {Math.ceil(post.wordCount / 200)} min read</span>}
      </div>
    </Link>
  );
}