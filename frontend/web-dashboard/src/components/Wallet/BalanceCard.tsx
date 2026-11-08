/**
 * BalanceCard — wallet summary (available/pending/lifetime).
 */

import { formatCurrency } from '@/utils/format';
import type { WalletSummary } from '@/types';

interface BalanceCardProps {
  wallet: WalletSummary;
}

export function BalanceCard({ wallet }: BalanceCardProps) {
  return (
    <div className="bg-gradient-to-br from-brand-600 to-brand-800 rounded-xl p-6 text-white">
      <div className="text-sm text-brand-100 mb-1">Available balance</div>
      <div className="text-3xl font-bold mb-4">
        {formatCurrency(wallet.available, wallet.currency)}
      </div>
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-brand-500/30">
        <div>
          <div className="text-xs text-brand-200">Lifetime earnings</div>
          <div className="text-sm font-semibold">
            {formatCurrency(wallet.lifetime, wallet.currency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-brand-200">Paid out</div>
          <div className="text-sm font-semibold">
            {formatCurrency(wallet.paidOut, wallet.currency)}
          </div>
        </div>
      </div>
    </div>
  );
}