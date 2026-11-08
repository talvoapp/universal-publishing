/**
 * Analytics page — revenue chart + metrics.
 */

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { walletApi } from '@/api/wallet.api';
import { Loader } from '@/components/common/Loader';
import { formatCurrency, formatNumber } from '@/utils/format';
import { showToast } from '@/components/common/Toast';
import type { AnalyticsResult } from '@/types';

const periods: Array<{ value: string; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

export function AnalyticsPage() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const result = await walletApi.getAnalytics(period);
        setData(result);
      } catch {
        showToast.error('Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="text-slate-600 mt-1">Track your revenue and performance</p>
        </div>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
        >
          {periods.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loader variant="page" label="Loading analytics…" />
      ) : !data ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No data available
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Gross revenue" value={formatCurrency(data.grossRevenue, data.currency)} />
            <StatCard label="Platform fees" value={formatCurrency(data.platformFees, data.currency)} />
            <StatCard label="Net earnings" value={formatCurrency(data.netEarnings, data.currency)} highlight />
            <StatCard label="Total sales" value={formatNumber(data.saleCount)} />
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-6">Revenue over time</h3>
            {data.daily.length === 0 ? (
              <div className="text-center text-slate-500 py-8">No sales in this period</div>
            ) : (
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={data.daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#64748b' }}
                      tickFormatter={(v: number) => `$${v}`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v, data.currency)}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? 'bg-brand-50 border-brand-200' : 'bg-white border-slate-200'}`}>
      <div className={`text-sm ${highlight ? 'text-brand-700' : 'text-slate-600'}`}>{label}</div>
      <div className={`text-2xl font-bold mt-1 ${highlight ? 'text-brand-900' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}