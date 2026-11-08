/**
 * PayoutForm — request a payout.
 */

import { useState } from 'react';
import { walletApi } from '@/api/wallet.api';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { showToast } from '@/components/common/Toast';

interface PayoutFormProps {
  available: string;
  currency: string;
  onSuccess?: () => void;
}

export function PayoutForm({ available, currency, onSuccess }: PayoutFormProps) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      showToast.error('Enter a valid amount');
      return;
    }
    if (amountCents > parseFloat(available) * 100) {
      showToast.error('Amount exceeds available balance');
      return;
    }

    setLoading(true);
    try {
      await walletApi.requestPayout(amountCents, currency);
      showToast.success('Payout requested');
      setAmount('');
      onSuccess?.();
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Payout failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="font-semibold text-slate-900 mb-4">Request payout</h3>
      <div className="text-sm text-slate-600 mb-4">
        Available: <strong>{available} {currency}</strong>
      </div>
      <div className="space-y-3">
        <Input
          label="Amount"
          type="number"
          min="10"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          iconLeft={<span className="text-slate-500">$</span>}
        />
        <Button type="submit" loading={loading} fullWidth>
          Request Payout
        </Button>
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Payouts typically arrive within 2–7 business days.
      </p>
    </form>
  );
}