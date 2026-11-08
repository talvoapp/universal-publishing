/**
 * Loader — full page, inline, or overlay.
 */

import { clsx } from 'clsx';

interface LoaderProps {
  variant?: 'page' | 'inline' | 'overlay';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-3',
};

export function Loader({ variant = 'inline', size = 'md', label }: LoaderProps) {
  const spinner = (
    <div
      className={clsx(
        'animate-spin rounded-full border-brand-600 border-t-transparent',
        sizeClasses[size],
      )}
      role="status"
      aria-label={label || 'Loading'}
    />
  );

  if (variant === 'page') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        {spinner}
        {label && <p className="text-sm text-slate-500">{label}</p>}
      </div>
    );
  }

  if (variant === 'overlay') {
    return (
      <div className="fixed inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center z-50">
        {spinner}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {spinner}
      {label && <span className="text-sm text-slate-500">{label}</span>}
    </div>
  );
}