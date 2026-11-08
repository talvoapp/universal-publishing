/**
 * CheckoutForm — initiates a Stripe checkout session.
 */

import { useState } from 'react';
import { marketplaceApi } from '@/api/marketplace.api';
import { Button } from '@/components/common/Button';
import { showToast } from '@/components/common/Toast';
import type { Item } from '@/types';

interface CheckoutFormProps {
  item: Item;
  selectedChapterIds?: string[];
}

export function CheckoutForm({ item, selectedChapterIds = [] }: CheckoutFormProps) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const idempotencyKey = `checkout-${item.id}-${Date.now()}`;
      const successUrl = `${window.location.origin}/checkout/success`;
      const cancelUrl = `${window.location.origin}/checkout/cancel`;

      const res = await marketplaceApi.initiateCheckout(
        {
          itemId: item.id,
          chapterIds: selectedChapterIds.length > 0 ? selectedChapterIds : undefined,
          successUrl,
          cancelUrl,
        },
        idempotencyKey,
      );

      // Redirect to Stripe
      window.location.href = res.checkout_url;
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="font-semibold text-slate-900 mb-4">Complete your purchase</h3>
      <div className="text-sm text-slate-600 mb-6">
        You'll be redirected to Stripe's secure checkout to complete payment.
      </div>
      <Button onClick={handleCheckout} loading={loading} fullWidth size="lg">
        Proceed to Checkout
      </Button>
    </div>
  );
}