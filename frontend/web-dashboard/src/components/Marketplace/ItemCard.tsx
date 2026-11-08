/**
 * ItemCard — displays a marketplace item (book, article, news).
 */

import { Link } from 'react-router-dom';
import { formatCents, formatNumber } from '@/utils/format';
import { PriceTag } from './PriceTag';
import type { Item } from '@/types';

interface ItemCardProps {
  item: Item;
}

export function ItemCard({ item }: ItemCardProps) {
  return (
    <Link
      to={`/checkout?item=${item.id}`}
      className="group block bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-card-hover transition-shadow"
    >
      {/* Cover */}
      <div className="aspect-[2/3] bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center overflow-hidden">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="text-white/80 text-center px-4">
            <div className="text-2xl font-bold leading-tight line-clamp-3">{item.title}</div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
          {item.type.replace('_', ' ')}
        </div>
        <h3 className="font-semibold text-slate-900 line-clamp-2 mb-2">{item.title}</h3>
        {item.description && (
          <p className="text-sm text-slate-600 line-clamp-2 mb-3">{item.description}</p>
        )}
        <div className="flex items-center justify-between">
          <PriceTag cents={item.priceCents} currency={item.currency} />
          <span className="text-xs text-slate-500">
            {formatNumber(item.wordCount)} words
          </span>
        </div>
      </div>
    </Link>
  );
}