/**
 * Formatting utilities for display.
 */

import { formatDistanceToNow, format, parseISO } from 'date-fns';

// ============================================================
// DATES
// ============================================================
export function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ============================================================
// MONEY
// ============================================================
export function formatCurrency(
  amount: number | string,
  currency = 'USD',
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return `${amount} ${currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(num);
}

export function formatCents(cents: number, currency = 'USD'): string {
  return formatCurrency(cents / 100, currency);
}

// ============================================================
// NUMBERS
// ============================================================
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

// ============================================================
// TEXT
// ============================================================
export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength).trimEnd() + '…';
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? singular + 's';
}

// ============================================================
// READ TIME
// ============================================================
export function formatReadTime(minutes: number): string {
  if (minutes < 1) return '<1 min read';
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m read` : `${hours}h read`;
}