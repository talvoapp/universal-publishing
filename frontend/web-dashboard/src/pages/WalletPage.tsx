/**
 * Wallet page — balance, ledger, payouts, Stripe Connect onboarding.
 */

import { useEffect, useState } from 'react';
import { walletApi } from '@/api/wallet.api';
import { useAuthStore } from '@/store/auth.store';
import { BalanceCard } from '@/components/Wallet/BalanceCard';
import { LedgerTable } from '@/components/Wallet/LedgerTable';
import { PayoutForm } from '@/components/Wallet/PayoutForm';
import { Button } from '@/components/common/Button';
import { Loader } from '@/components/common/Loader';
import { showToast } from '@/components/common/Toast';
import type { WalletSummary, LedgerEntry, Payout, ConnectStatus } from '@/types';

export function WalletPage() {
  const user = useAuthStore((s) => s.user);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [connect, setConnect] = useState<ConnectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState<'ledger' | 'payouts'>('ledger');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [walletRes, ledgerRes, payoutsRes, connectRes] = await Promise.all([
        walletApi.getSummary(),
        walletApi.listLedger(undefined, 20),
        walletApi.listPayouts(),
        walletApi.getConnectStatus().catch(() => null),
      ]);
      setWallet(walletRes);
      setEntries(ledgerRes.entries);
      setPayouts(payoutsRes.payouts);
      setConnect(connectRes);
    } catch {
      showToast.error('Failed to load wallet');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleOnboard = async () => {
    setOnboarding(true);
    try {
      const { url } = await walletApi.startConnectOnboarding();
      window.location.href = url;
    } catch {
      showToast.error('Failed to start onboarding');
      setOnboarding(false);
    }
  };

  if (loading) return <Loader variant="page" label="Loading wallet…" />;
  if (!wallet) return null;

  const needsOnboarding = connect?.status !== 'active';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Wallet</h1>
        <p className="text-slate-600 mt-1">Manage your earnings and payouts</p>
      </div>

      {/* Connect banner */}
      {needsOnboarding && (
        <div className="bg-warning-50 border border-warning-200 rounded-xl p-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-warning-900">Complete your Stripe onboarding</h3>
            <p className="text-sm text-warning-800 mt-1">
              {connect?.status === 'restricted'
                ? 'Stripe needs additional information to enable payouts.'
                : 'Set up your Connect account to receive payouts from sales.'}
            </p>
          </div>
          <Button onClick={handleOnboard} loading={onboarding} variant="primary">
            {connect?.status === 'restricted' ? 'Complete Setup' : 'Start Onboarding'}
          </Button>
        </div>
      )}

      {/* Balance + Payout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <BalanceCard wallet={wallet} />

          {/* Tabs */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 px-2 flex gap-1">
              <button
                onClick={() => setActiveTab('ledger')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'ledger'
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Ledger
              </button>
              <button
                onClick={() => setActiveTab('payouts')}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'payouts'
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Payouts ({payouts.length})
              </button>
            </div>

            <div className="p-0">
              {activeTab === 'ledger' ? (
                <LedgerTable entries={entries} />
              ) : payouts.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No payouts yet.</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payouts.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {new Date(p.requestedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {p.amount} {p.currency}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${
                            p.status === 'completed' ? 'bg-success-50 text-success-700' :
                            p.status === 'processing' ? 'bg-brand-50 text-brand-700' :
                            p.status === 'failed' ? 'bg-danger-50 text-danger-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Payout form */}
        <div className="space-y-4">
          {!needsOnboarding && (
            <PayoutForm
              available={wallet.available}
              currency={wallet.currency}
              onSuccess={() => void loadAll()}
            />
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-500 space-y-2">
            <div className="font-medium text-slate-700 mb-2">Payout policy</div>
            <div>• Minimum: $10.00</div>
            <div>• Maximum: $10,000.00</div>
            <div>• Arrives in 2–7 business days</div>
          </div>
        </div>
      </div>
    </div>
  );
}