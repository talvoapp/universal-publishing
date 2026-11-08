/**
 * Dashboard — overview with stats cards + quick actions.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { editorApi } from '@/api/editor.api';
import { walletApi } from '@/api/wallet.api';
import { useAuthStore } from '@/store/auth.store';
import { formatCurrency, formatNumber, formatRelative } from '@/utils/format';
import { Loader } from '@/components/common/Loader';
import type { DraftSummary, WalletSummary } from '@/types';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [draftsRes, walletRes] = await Promise.all([
          editorApi.listDrafts({ limit: 5 }),
          walletApi.getSummary().catch(() => null),
        ]);
        setDrafts(draftsRes.data);
        setWallet(walletRes);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <Loader variant="page" label="Loading dashboard…" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back, {user?.displayName?.split(' ')[0] || 'author'}!
        </h1>
        <p className="text-slate-600 mt-1">Here's what's happening with your writing.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total drafts"
          value={formatNumber(drafts.length)}
          hint={`${drafts.filter((d) => d.status === 'published').length} published`}
        />
        <StatCard
          label="Available balance"
          value={wallet ? formatCurrency(wallet.available, wallet.currency) : '—'}
          hint={wallet?.connectStatus === 'active' ? 'Ready to withdraw' : 'Onboarding pending'}
        />
        <StatCard
          label="Lifetime earnings"
          value={wallet ? formatCurrency(wallet.lifetime, wallet.currency) : '—'}
          hint={wallet ? `Paid out: ${formatCurrency(wallet.paidOut, wallet.currency)}` : ''}
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          to="/editor"
          className="group bg-white rounded-xl border border-slate-200 p-6 hover:shadow-card-hover transition-shadow"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">Start writing</h3>
          </div>
          <p className="text-sm text-slate-600">Open the editor and begin a new draft.</p>
        </Link>

        <Link
          to="/wallet"
          className="group bg-white rounded-xl border border-slate-200 p-6 hover:shadow-card-hover transition-shadow"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success-50 flex items-center justify-center text-success-600">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12V7H5a2 2 0 010-4h14v4" />
                <path d="M3 5v14a2 2 0 002 2h16v-5" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-900">Manage wallet</h3>
          </div>
          <p className="text-sm text-slate-600">View earnings, request payouts, manage Connect.</p>
        </Link>
      </div>

      {/* Recent drafts */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Recent drafts</h3>
          <Link to="/drafts" className="text-sm text-brand-600 hover:text-brand-700">
            View all →
          </Link>
        </div>
        {drafts.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No drafts yet.{' '}
            <Link to="/editor" className="text-brand-600 hover:underline">Create your first one</Link>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {drafts.map((draft) => (
              <li key={draft.id}>
                <Link to={`/editor/${draft.id}`} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50">
                  <div>
                    <div className="font-medium text-slate-900">{draft.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {draft.status} · {formatRelative(draft.updatedAt)}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">{formatNumber(draft.wordCount)} words</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="text-sm text-slate-600 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}