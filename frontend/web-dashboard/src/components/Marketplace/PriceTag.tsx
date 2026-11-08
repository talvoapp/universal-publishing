/**
 * PriceTag — formatted price display.
 */

import { formatCents } from '@/utils/format';
import { clsx } from 'clsx';

interface PriceTagProps {
  cents: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

export function PriceTag({ cents, currency = 'USD', size = 'md', className }: PriceTagProps) {
  const isFree = cents === 0;
  return (
    <span
      className={clsx(
        'font-semibold',
        isFree ? 'text-success-600' : 'text-slate-900',
        sizeClasses[size],
        className,
      )}
    >
      {isFree ? 'Free' : formatCents(cents, currency)}
    </span>
  );
}