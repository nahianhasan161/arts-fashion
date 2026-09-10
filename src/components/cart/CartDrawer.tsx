"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, Truck } from "lucide-react";
import { useCartStore } from "@/lib/store/cart-store";

export function CartDrawer() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { 
    items, 
    isOpen, 
    closeCart, 
    updateQuantity, 
    removeItem, 
    getSubtotal, 
    getTotalCount 
  } = useCartStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const subtotal = getSubtotal();
  const totalCount = getTotalCount();
  const freeShippingThreshold = 1500;
  const progress = Math.min(100, Math.round((subtotal / freeShippingThreshold) * 100));
  const remainingForFree = Math.max(0, freeShippingThreshold - subtotal);
  const shippingFee = subtotal >= freeShippingThreshold || subtotal === 0 ? 0 : 60;
  const grandTotal = subtotal + shippingFee;

  const handleProceedCheckout = () => {
    closeCart();
    router.push("/checkout");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={closeCart}
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-surface-card shadow-2xl flex flex-col">
          {/* 1. Header */}
          <div className="px-space-base py-space-md border-b border-border-light flex items-center justify-between bg-surface-subtle">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-primary" />
              <h2 className="font-display uppercase tracking-wider text-base font-bold text-primary">
                Your Shopping Bag ({totalCount})
              </h2>
            </div>
            <button
              onClick={closeCart}
              className="p-1 rounded-md text-text-muted hover:text-primary hover:bg-surface-container transition-colors"
              aria-label="Close cart"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 2. Free Shipping Progress Meter */}
          <div className="px-space-base py-3 bg-accent-gold-soft border-b border-accent-gold/20">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary mb-1.5">
              <Truck className="w-4 h-4 text-accent-gold shrink-0" />
              {remainingForFree > 0 ? (
                <span>
                  Add <strong className="text-secondary font-bold">৳ {remainingForFree}</strong> more to unlock <strong className="font-bold">FREE Delivery</strong>!
                </span>
              ) : (
                <span className="text-emerald-700 font-bold">
                  🎉 Congratulations! You have unlocked FREE Delivery!
                </span>
              )}
            </div>
            <div className="w-full bg-white h-2 rounded-full overflow-hidden border border-accent-gold/20">
              <div
                className="bg-accent-gold h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* 3. Items List */}
          <div className="flex-1 overflow-y-auto px-space-base py-space-md divide-y divide-border-light">
            {items.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-text-muted">
                <div className="w-16 h-16 rounded-full bg-surface-subtle flex items-center justify-center mb-4 text-text-muted">
                  <ShoppingBag className="w-8 h-8 opacity-40" />
                </div>
                <h3 className="font-display uppercase tracking-wider text-base font-bold text-primary mb-1">
                  Your bag is empty
                </h3>
                <p className="text-xs text-text-muted mb-6 max-w-xs">
                  Looks like you haven&apos;t added any items to your shopping bag yet.
                </p>
                <button
                  onClick={closeCart}
                  className="px-6 py-2.5 bg-primary text-white font-display uppercase tracking-wider text-xs font-semibold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
                >
                  Start Shopping
                </button>
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="py-4 flex gap-3">
                  {/* Thumbnail */}
                  <div className="relative w-20 h-24 bg-surface-subtle rounded-lg overflow-hidden shrink-0 border border-border-light">
                    <Image
                      src={item.image}
                      alt={item.title}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/products/${item.slug}`}
                          onClick={closeCart}
                          className="font-body text-sm font-semibold text-on-surface hover:text-primary transition-colors line-clamp-1"
                        >
                          {item.title}
                        </Link>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-text-muted hover:text-badge-discount transition-colors p-1"
                          aria-label="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mt-1 text-xs text-text-muted">
                        <span className="bg-surface-subtle px-1.5 py-0.5 rounded font-medium border border-border-light">
                          Size: <strong className="text-primary font-bold">{item.size}</strong>
                        </span>
                        <span className="bg-surface-subtle px-1.5 py-0.5 rounded font-medium border border-border-light truncate max-w-[120px]">
                          {item.color}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      {/* Quantity Stepper */}
                      <div className="flex items-center bg-surface-subtle rounded border border-border-light">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1 hover:bg-surface-container text-on-surface transition-colors"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-2.5 text-xs font-bold text-primary">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= item.maxStock}
                          className="p-1 hover:bg-surface-container text-on-surface transition-colors disabled:opacity-30"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Line Price */}
                      <div className="text-right">
                        <span className="font-bold text-sm text-primary">
                          ৳ {(item.price * item.quantity).toLocaleString()}
                        </span>
                        {item.original_price > item.price && (
                          <span className="block text-[10px] text-text-muted line-through">
                            ৳ {(item.original_price * item.quantity).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* 4. Footer & Checkout CTA */}
          {items.length > 0 && (
            <div className="p-space-base bg-surface-subtle border-t border-border-light flex flex-col gap-3">
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between text-text-muted">
                  <span>Subtotal</span>
                  <span className="text-on-surface font-semibold">
                    ৳ {subtotal.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Estimated Delivery</span>
                  <span className={shippingFee === 0 ? "text-emerald-700 font-bold" : "text-on-surface font-semibold"}>
                    {shippingFee === 0 ? "FREE" : `৳ ${shippingFee}`}
                  </span>
                </div>
                <div className="border-t border-border-light pt-2 flex justify-between text-sm font-bold text-primary">
                  <span>Total Amount</span>
                  <span className="text-base font-display text-primary">
                    ৳ {grandTotal.toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                onClick={handleProceedCheckout}
                className="w-full h-12 bg-primary hover:bg-primary-container text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99]"
              >
                <span>PROCEED TO CHECKOUT</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <p className="text-[10px] text-center text-text-muted">
                Cash on delivery available nationwide • Free returns within 7 days
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
