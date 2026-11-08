/**
 * Shopping cart store (Zustand).
 *
 * For pay-per-chapter items, the cart holds itemID + chapterIDs.
 * For pay-per-book items, it holds just the itemID.
 *
 * Persisted to sessionStorage (lost on browser close — deliberate,
 * to prevent stale carts from abandoned sessions).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ============================================================
// STATE
// ============================================================
interface CartItem {
  itemId: string;
  itemTitle: string;
  itemType: 'book' | 'article' | 'news_post';
  pricingModel: 'pay_per_book' | 'pay_per_chapter' | 'subscription';
  priceCents: number;
  currency: string;
  chapterIds: string[]; // for pay_per_chapter, empty for pay_per_book
  coverUrl?: string;
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (itemId: string) => void;
  updateChapters: (itemId: string, chapterIds: string[]) => void;
  clear: () => void;

  // Derived
  getSubtotalCents: () => number;
  getItemCount: () => number;
  hasItem: (itemId: string) => boolean;
}

// ============================================================
// STORE
// ============================================================
export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => {
        const existing = get().items.find((i) => i.itemId === item.itemId);
        if (existing) {
          // Merge chapters for pay_per_chapter
          if (item.pricingModel === 'pay_per_chapter') {
            const merged = Array.from(new Set([...existing.chapterIds, ...item.chapterIds]));
            set({
              items: get().items.map((i) =>
                i.itemId === item.itemId ? { ...i, chapterIds: merged } : i,
              ),
            });
          }
          return;
        }
        set({ items: [...get().items, item] });
      },

      removeItem: (itemId) => {
        set({ items: get().items.filter((i) => i.itemId !== itemId) });
      },

      updateChapters: (itemId, chapterIds) => {
        set({
          items: get().items.map((i) =>
            i.itemId === itemId ? { ...i, chapterIds } : i,
          ),
        });
      },

      clear: () => set({ items: [] }),

      getSubtotalCents: () =>
        get().items.reduce((sum, item) => sum + item.priceCents, 0),

      getItemCount: () => get().items.length,

      hasItem: (itemId) => get().items.some((i) => i.itemId === itemId),
    }),
    {
      name: 'upp-cart',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);