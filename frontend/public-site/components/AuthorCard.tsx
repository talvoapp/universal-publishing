/**
 * AuthorCard — author profile card.
 */

import Link from 'next/link';
import type { AuthorSummary } from '@/lib/types';

interface AuthorCardProps {
  author: AuthorSummary;
  postCount?: number;
}

export function AuthorCard({ author, postCount }: AuthorCardProps) {
  return (
    <Link
      href={`/author/${author.id}`}
      className="group flex items-center gap-4 p-5 bg-white rounded-xl border border-slate-200 hover:shadow-lg transition-shadow"
    >
      <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xl font-bold flex-shrink-0">
        {author.avatarUrl ? (
          <img
            src={author.avatarUrl}
            alt={author.displayName}
            className="w-full h-full rounded-full object-cover"
          />
        ) : (
          author.displayName.slice(0, 2).toUpperCase()
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">
          {author.displayName}
        </h3>
        {author.bio && <p className="text-sm text-slate-600 line-clamp-2 mt-1">{author.bio}</p>}
        {postCount !== undefined && (
          <p className="text-xs text-slate-500 mt-1">
            {postCount} {postCount === 1 ? 'post' : 'posts'}
          </p>
        )}
      </div>
    </Link>
  );
}