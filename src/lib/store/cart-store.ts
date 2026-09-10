import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { CartItem, Product } from "@/types";

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
  addItem: (
    product: Product,
    size: string,
    color: string,
    quantity?: number
  ) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  getTotalCount: () => number;
  getSubtotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      addItem: (product, size, color, quantity = 1) => {
        set((state) => {
          const itemId = `${product.id}-${size}-${color}`;
          const existingIndex = state.items.findIndex(
            (item) => item.id === itemId
          );

          if (existingIndex > -1) {
            const updatedItems = [...state.items];
            const currentItem = updatedItems[existingIndex];
            const newQty = Math.min(
              currentItem.quantity + quantity,
              currentItem.maxStock
            );
            updatedItems[existingIndex] = {
              ...currentItem,
              quantity: newQty,
            };
            return { items: updatedItems, isOpen: true };
          }

          const targetSize = product.sizes.find((s) => s.size === size);
          const maxStock = targetSize ? targetSize.stock : 20;

          const newItem: CartItem = {
            id: itemId,
            productId: product.id,
            slug: product.slug,
            title: product.title,
            price: product.price,
            original_price: product.original_price,
            image: product.images[0],
            size,
            color,
            quantity: Math.min(quantity, maxStock),
            maxStock,
          };

          return {
            items: [...state.items, newItem],
            isOpen: true,
          };
        });
      },

      removeItem: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        }));
      },

      updateQuantity: (id, quantity) => {
        set((state) => {
          if (quantity <= 0) {
            return { items: state.items.filter((item) => item.id !== id) };
          }
          return {
            items: state.items.map((item) =>
              item.id === id
                ? { ...item, quantity: Math.min(quantity, item.maxStock) }
                : item
            ),
          };
        });
      },

      clearCart: () => set({ items: [] }),

      getTotalCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },

      getSubtotal: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0
        );
      },
    }),
    {
      name: "arts-fashion-cart-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    }
  )
);
