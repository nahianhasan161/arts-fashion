"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Product } from "@/types";
import { useCartStore } from "@/lib/store/cart-store";
import { useWishlistStore } from "@/lib/store/wishlist-store";

interface ProductCardProps {
  product: Product;
  aspectRatio?: "portrait" | "square";
}

export function ProductCard({ product, aspectRatio = "portrait" }: ProductCardProps) {
  const { addItem } = useCartStore();
  const { toggleWishlist, isInWishlist } = useWishlistStore();

  const isLiked = isInWishlist(product.id);

  const handleQuickAdd = (e: React.MouseEvent, size: string) => {
    e.preventDefault();
    e.stopPropagation();
    const defaultColor = product.colors[0]?.name || "Default";
    addItem(product, size, defaultColor, 1);
  };

  const handleWishlistClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product);
  };

  const badgeColorClass =
    product.badge_type === "discount"
      ? "bg-badge-discount text-white"
      : product.badge_type === "festive"
      ? "bg-secondary text-white"
      : "bg-badge-new text-white";

  return (
    <div className="group flex flex-col bg-surface-card rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all border border-border-light/60">
      {/* 1. Image Container */}
      <Link
        href={`/products/${product.slug}`}
        className={`relative w-full ${
          aspectRatio === "square" ? "aspect-square" : "aspect-[3/4]"
        } bg-surface-subtle overflow-hidden block`}
      >
        <Image
          src={product.images[0]}
          alt={product.title}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
        />

        {/* Badges */}
        {product.badge && (
          <span
            className={`absolute top-2 left-2 ${badgeColorClass} font-bold text-[10px] px-2 py-0.5 rounded uppercase tracking-wider shadow-sm`}
          >
            {product.badge}
          </span>
        )}

        {/* Wishlist Toggle Button */}
        <button
          onClick={handleWishlistClick}
          aria-label="Add to wishlist"
          className={`absolute top-2 right-2 w-8 h-8 rounded-full bg-surface-card/90 backdrop-blur-sm flex items-center justify-center transition-all ${
            isLiked
              ? "text-badge-discount scale-110 shadow-sm"
              : "text-text-muted hover:text-badge-discount"
          }`}
        >
          <Heart
            className="w-4 h-4"
            fill={isLiked ? "currentColor" : "none"}
          />
        </button>

        {/* Slide-up Quick Size Bar on Hover */}
        <div className="absolute bottom-2 inset-x-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-surface-card/95 backdrop-blur-sm rounded-md p-1.5 flex items-center justify-between shadow-md">
          <span className="text-[10px] font-bold text-text-muted uppercase pl-1 hidden sm:inline">
            Quick Add:
          </span>
          <div className="flex items-center gap-1 justify-around flex-1 sm:flex-initial">
            {product.sizes.slice(0, 4).map((s) => (
              <button
                key={s.size}
                disabled={s.stock === 0}
                onClick={(e) => handleQuickAdd(e, s.size)}
                className="w-7 h-7 rounded text-[11px] font-bold text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-primary flex items-center justify-center border border-border-light hover:border-primary"
                title={`${s.size} - Chest ${s.chest}" (${s.stock} in stock)`}
              >
                {s.size}
              </button>
            ))}
          </div>
        </div>
      </Link>

      {/* 2. Details */}
      <div className="p-space-sm flex flex-col flex-1 justify-between gap-1">
        <div>
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
            {product.sub_category || product.category}
          </span>
          <Link
            href={`/products/${product.slug}`}
            className="font-body text-xs sm:text-sm text-on-surface font-medium line-clamp-1 group-hover:text-primary transition-colors block mt-0.5"
            title={product.title}
          >
            {product.title}
          </Link>
        </div>

        {/* Pricing */}
        <div className="flex items-baseline gap-2 pt-1">
          <span className="font-display font-bold text-sm sm:text-base text-primary">
            ৳ {product.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
          {product.original_price > product.price && (
            <span className="text-xs text-text-muted line-through">
              ৳ {product.original_price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
