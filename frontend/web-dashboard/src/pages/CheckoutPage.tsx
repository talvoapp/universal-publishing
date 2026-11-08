/**
 * Checkout page — item details + Stripe checkout.
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { marketplaceApi } from '@/api/marketplace.api';
import { contentApi } from '@/api/editor.api';
import { Button } from '@/components/common/Button';
import { Loader } from '@/components/common/Loader';
import { PriceTag } from '@/components/Marketplace/PriceTag';
import { showToast } from '@/components/common/Toast';
import { formatNumber } from '@/utils/format';
import type { Item, Chapter } from '@/types';

export function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const itemId = searchParams.get('item');

  const [item, setItem] = useState<Item | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    if (!itemId) {
      navigate('/dashboard');
      return;
    }
    void (async () => {
      try {
        const [itemData, chaptersData] = await Promise.all([
          marketplaceApi.getItem(itemId),
          contentApi.listChapters(itemId).catch(() => null),
        ]);
        setItem(itemData);
        if (chaptersData) {
          setChapters(chaptersData.chapters);
        }
      } catch {
        showToast.error('Item not found');
        navigate('/dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [itemId, navigate]);

  const handleCheckout = async () => {
    if (!item) return;
    setCheckingOut(true);
    try {
      const idempotencyKey = `checkout-${item.id}-${Date.now()}`;
      const res = await marketplaceApi.initiateCheckout(
        {
          itemId: item.id,
          chapterIds: selectedChapters.length > 0 ? selectedChapters : undefined,
          successUrl: `${window.location.origin}/checkout/success`,
          cancelUrl: `${window.location.origin}/checkout/cancel`,
        },
        idempotencyKey,
      );
      window.location.href = res.checkout_url;
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Checkout failed');
      setCheckingOut(false);
    }
  };

  const toggleChapter = (id: string) => {
    setSelectedChapters((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  if (loading) return <Loader variant="page" label="Loading item…" />;
  if (!item) return null;

  return (
    <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main: item details */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="aspect-[16/9] bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            {item.coverUrl ? (
              <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover" />
            ) : (
              <div className="text-white text-center px-8">
                <h2 className="text-3xl font-bold">{item.title}</h2>
              </div>
            )}
          </div>
          <div className="p-6">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              {item.type.replace('_', ' ')}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-3">{item.title}</h1>
            {item.description && <p className="text-slate-600 mb-4">{item.description}</p>}
            <div className="flex items-center gap-4 text-sm text-slate-500">
              <span>{formatNumber(item.wordCount)} words</span>
              <span>{item.readMinutes} min read</span>
              <span>{item.language}</span>
            </div>
          </div>
        </div>

        {/* Chapters (if pay_per_chapter) */}
        {item.pricingModel === 'pay_per_chapter' && chapters.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Select chapters</h2>
            <div className="space-y-2">
              {chapters.map((ch) => (
                <label key={ch.chapterId} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ch.free || selectedChapters.includes(ch.chapterId)}
                    disabled={ch.free}
                    onChange={() => toggleChapter(ch.chapterId)}
                    className="rounded"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">Chapter {ch.index}: {ch.title}</div>
                    <div className="text-xs text-slate-500">{formatNumber(ch.wordCount)} words</div>
                  </div>
                  {ch.free && <span className="text-xs font-medium text-success-600">FREE</span>}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sidebar: purchase */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-6 sticky top-20">
          <div className="text-sm text-slate-600 mb-1">Total price</div>
          <div className="mb-4">
            <PriceTag cents={item.priceCents} currency={item.currency} size="lg" />
          </div>
          <Button onClick={handleCheckout} loading={checkingOut} fullWidth size="lg">
            Proceed to checkout
          </Button>
          <p className="text-xs text-slate-500 mt-3 text-center">
            Secure payment via Stripe
          </p>
        </div>
      </div>
    </div>
  );
}