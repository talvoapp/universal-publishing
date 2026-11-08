/**
 * LedgerTable — paginated ledger entries.
 */

import { formatCurrency, formatDateTime } from '@/utils/format';
import type { LedgerEntry } from '@/types';

interface LedgerTableProps {
  entries: LedgerEntry[];
  loading?: boolean;
}

export function LedgerTable({ entries, loading }: LedgerTableProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        No transactions yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Date</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Type</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Reference</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((entry, i) => {
            const amount = parseFloat(entry.credit) - parseFloat(entry.debit);
            const positive = amount >= 0;
            return (
              <tr key={`${entry.transactionId}-${i}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-600">
                  {formatDateTime(entry.occurredAt)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-900 font-medium">{entry.type}</td>
                <td className="px-4 py-3 text-sm text-slate-500 font-mono text-xs">
                  {entry.reference.slice(0, 12)}…
                </td>
                <td className={`px-4 py-3 text-sm font-medium text-right ${positive ? 'text-success-600' : 'text-slate-700'}`}>
                  {positive ? '+' : ''}{formatCurrency(amount, entry.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}