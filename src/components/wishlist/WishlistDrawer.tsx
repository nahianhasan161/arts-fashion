"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X, Trash2, Heart, ShoppingBag } from "lucide-react";
import { useWishlistStore } from "@/lib/store/wishlist-store";
import { useCartStore } from "@/lib/store/cart-store";

export function WishlistDrawer() {
  const [mounted, setMounted] = useState(false);
  const {
    items,
    isOpen,
    closeWishlist,
    removeItem,
    getCount,
  } = useWishlistStore();
  const { addItem: addToCart } = useCartStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const wishlistCount = getCount();

  const handleAddToCart = (product: typeof items[0]) => {
    const defaultSize = product.sizes.find((s) => s.stock > 0)?.size || product.sizes[0]?.size || "M";
    const defaultColor = product.colors[0]?.name || "Default";
    addToCart(product, defaultSize, defaultColor, 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={closeWishlist}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-surface-card shadow-2xl flex flex-col">
          {/* 1. Header */}
          <div className="px-space-base py-space-md border-b border-border-light flex items-center justify-between bg-surface-subtle">
            <div className="flex items-center gap-2">
              <Heart className="w-5 h-5 text-badge-discount" />
              <h2 className="font-display uppercase tracking-wider text-base font-bold text-primary">
                My Wishlist ({wishlistCount})
              </h2>
            </div>
            <button
              onClick={closeWishlist}
              className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-surface-container transition-colors"
              aria-label="Close wishlist"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 2. Items List */}
          <div className="flex-1 overflow-y-auto px-space-base py-space-md divide-y divide-border-light">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-text-muted">
                <div className="w-16 h-16 rounded-full bg-surface-subtle flex items-center justify-center mb-4 text-text-muted">
                  <Heart className="w-8 h-8 opacity-40" />
                </div>
                <h3 className="font-display uppercase tracking-wider text-base font-bold text-primary mb-1">
                  Your wishlist is empty
                </h3>
                <p className="text-xs text-text-muted mb-6 max-w-xs">
                  Browse our collection and tap the heart icon on products you love to save them here.
                </p>
                <button
                  onClick={closeWishlist}
                  className="px-6 py-2.5 bg-primary text-white font-display uppercase tracking-wider text-xs font-semibold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
                >
                  Explore Products
                </button>
              </div>
            ) : (
              items.map((product) => (
                <div key={product.id} className="py-4 flex gap-3">
                  {/* Thumbnail */}
                  <Link
                    href={`/products/${product.slug}`}
                    onClick={closeWishlist}
                    className="relative w-20 h-24 bg-surface-subtle rounded-lg overflow-hidden shrink-0 border border-border-light block"
                  >
                    <Image
                      src={product.images[0]}
                      alt={product.title}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </Link>

                  {/* Details */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/products/${product.slug}`}
                          onClick={closeWishlist}
                          className="font-body text-sm font-semibold text-on-surface hover:text-primary transition-colors line-clamp-2"
                        >
                          {product.title}
                        </Link>
                        <button
                          onClick={() => removeItem(product.id)}
                          className="text-text-muted hover:text-badge-discount transition-colors p-1 shrink-0"
                          aria-label="Remove from wishlist"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                        <span className="text-[10px] uppercase tracking-wider">
                          {product.sub_category || product.category}
                        </span>
                        {product.stock > 0 ? (
                          <span className="text-emerald-600 font-semibold text-[10px]">In Stock</span>
                        ) : (
                          <span className="text-badge-discount font-semibold text-[10px]">Out of Stock</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      {/* Price */}
                      <div>
                        <span className="font-bold text-sm text-primary">
                          ৳ {product.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </span>
                        {product.original_price > product.price && (
                          <span className="ml-1.5 text-[10px] text-text-muted line-through">
                            ৳ {product.original_price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </span>
                        )}
                      </div>

                      {/* Add to Cart Button */}
                      <button
                        onClick={() => handleAddToCart(product)}
                        disabled={product.stock === 0}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-primary text-white text-[10px] font-bold uppercase tracking-wider rounded-md hover:bg-primary-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        <ShoppingBag className="w-3 h-3" />
                        Add to Bag
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 3. Footer */}
          {items.length > 0 && (
            <div className="p-space-base bg-surface-subtle border-t border-border-light flex flex-col gap-3">
              <p className="text-[10px] text-center text-text-muted">
                {wishlistCount} {wishlistCount === 1 ? "item" : "items"} saved • Tap a product to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
