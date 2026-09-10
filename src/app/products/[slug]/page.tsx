"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { 
  Home, 
  ChevronRight, 
  Star, 
  Heart, 
  Share2, 
  Check, 
  Plus, 
  Minus, 
  ShoppingBag, 
  Zap, 
  Truck, 
  RotateCcw, 
  ShieldCheck, 
  Ruler, 
  AlertCircle 
} from "lucide-react";
import { getProductBySlug } from "@/lib/services/products";
import { Product } from "@/types";
import { useCartStore } from "@/lib/store/cart-store";
import { useWishlistStore } from "@/lib/store/wishlist-store";

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImgIndex, setSelectedImgIndex] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [quantity, setQuantity] = useState(1);
  const [sizeModalOpen, setSizeModalOpen] = useState(false);

  const { addItem } = useCartStore();
  const { toggleWishlist, isInWishlist } = useWishlistStore();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await getProductBySlug(slug);
      if (data) {
        setProduct(data);
        setSelectedColor(data.colors[0]?.name || "Default");
        setSelectedSize(data.sizes[1]?.size || data.sizes[0]?.size || "M");
      }
      setLoading(false);
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-container-max mx-auto px-space-base py-24 text-center">
        <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-3 text-xs text-text-muted font-display uppercase tracking-wider">
          Loading product details...
        </p>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-container-max mx-auto px-space-base py-24 text-center">
        <h2 className="font-display text-2xl uppercase font-bold text-primary mb-2">
          Product Not Found
        </h2>
        <p className="text-xs text-text-muted mb-6">
          The requested product could not be located in our catalog.
        </p>
        <Link
          href="/shop"
          className="px-6 py-2.5 bg-primary text-white font-display text-xs uppercase font-bold rounded-lg"
        >
          Return to Shop
        </Link>
      </div>
    );
  }

  const isLiked = isInWishlist(product.id);
  const currentSizeObj = product.sizes.find((s) => s.size === selectedSize);
  const availableStock = currentSizeObj ? currentSizeObj.stock : product.stock;

  const handleAddToCart = () => {
    addItem(product, selectedSize, selectedColor, quantity);
  };

  const handleBuyNow = () => {
    addItem(product, selectedSize, selectedColor, quantity);
    router.push("/checkout");
  };

  return (
    <div className="w-full pb-space-3xl">
      {/* 1. Breadcrumbs */}
      <div className="w-full bg-surface-subtle border-b border-border-light py-2.5">
        <div className="max-w-container-max mx-auto px-space-base flex items-center gap-1.5 text-xs text-text-muted flex-wrap">
          <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <ChevronRight className="w-3 h-3 opacity-40" />
          <Link href="/shop?category=men" className="hover:text-primary transition-colors capitalize">
            {product.category}
          </Link>
          <ChevronRight className="w-3 h-3 opacity-40" />
          <span className="text-on-surface font-semibold truncate max-w-xs md:max-w-none">
            {product.title}
          </span>
        </div>
      </div>

      {/* 2. Main Product Section */}
      <section className="w-full py-space-xl">
        <div className="max-w-container-max mx-auto px-space-base">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl lg:gap-space-2xl items-start">
            {/* LEFT: Gallery Module (7 cols) */}
            <div className="lg:col-span-7 flex flex-col-reverse md:flex-row gap-space-base items-start">
              {/* Vertical Thumbnail Strip */}
              <div className="flex md:flex-col gap-2 w-full md:w-20 overflow-x-auto md:overflow-y-auto no-scrollbar shrink-0">
                {product.images.map((imgUrl, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImgIndex(idx)}
                    className={`relative rounded-lg overflow-hidden w-16 h-20 md:w-20 md:h-24 bg-surface-subtle transition-all shrink-0 border-2 ${
                      selectedImgIndex === idx
                        ? "border-primary shadow-sm"
                        : "border-border-light hover:border-text-muted"
                    }`}
                  >
                    <Image
                      src={imgUrl}
                      alt={`${product.title} view ${idx + 1}`}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>

              {/* Main Gallery Stage */}
              <div className="flex-1 w-full bg-surface-card rounded-xl overflow-hidden shadow-sm border border-border-light relative group">
                {/* Floating Badges */}
                <div className="absolute top-4 left-4 z-20 flex flex-col gap-1.5 pointer-events-none">
                  {product.discount_percent > 0 && (
                    <span className="bg-badge-discount text-white font-display text-xs px-3 py-1 rounded-full uppercase tracking-wider shadow-sm font-bold">
                      {product.discount_percent}% OFF
                    </span>
                  )}
                  <span className="bg-primary text-white font-display text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> IN STOCK
                  </span>
                </div>

                {/* Floating Wishlist & Share */}
                <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                  <button
                    onClick={() => toggleWishlist(product)}
                    aria-label="Wishlist"
                    className={`w-9 h-9 rounded-full bg-surface-card/90 backdrop-blur-md shadow-md flex items-center justify-center transition-all ${
                      isLiked
                        ? "text-badge-discount scale-110"
                        : "text-text-muted hover:text-badge-discount"
                    }`}
                  >
                    <Heart className="w-4 h-4" fill={isLiked ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({ title: product.title, url: window.location.href });
                      } else {
                        navigator.clipboard.writeText(window.location.href);
                        alert("Product link copied to clipboard!");
                      }
                    }}
                    aria-label="Share"
                    className="w-9 h-9 rounded-full bg-surface-card/90 backdrop-blur-md shadow-md text-text-muted hover:text-primary transition-all flex items-center justify-center"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Main Large Image */}
                <div className="relative w-full aspect-[4/5] bg-surface-subtle overflow-hidden flex items-center justify-center">
                  <Image
                    src={product.images[selectedImgIndex] || product.images[0]}
                    alt={product.title}
                    fill
                    priority
                    sizes="(max-width: 1024px) 100vw, 55vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>

                {/* Quick Feature Micro Banners */}
                <div className="grid grid-cols-3 bg-surface-subtle p-3 text-center border-t border-border-light text-xs font-semibold text-on-surface">
                  <div className="flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-accent-gold" />
                    <span>100% Organic</span>
                  </div>
                  <div className="flex items-center justify-center gap-1.5 border-x border-border-light">
                    <Check className="w-4 h-4 text-accent-gold" />
                    <span>175 GSM Drape</span>
                  </div>
                  <div className="flex items-center justify-center gap-1.5">
                    <RotateCcw className="w-4 h-4 text-accent-gold" />
                    <span>Pre-Shrunk Wash</span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT: Product Purchasing & Detail Column (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-space-lg">
              {/* Header Title Block */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-accent-gold font-display text-xs tracking-widest uppercase font-bold">
                    Streetwear • Edition 2025
                  </span>
                  <span className="w-1 h-1 rounded-full bg-border-light"></span>
                  <span className="text-text-muted text-xs">SKU: FL-GENZ-7410</span>
                </div>

                <h1 className="font-display text-2xl sm:text-3xl text-primary uppercase tracking-tight font-bold leading-tight">
                  {product.title}
                </h1>
                <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                  {product.description}
                </p>

                {/* Rating & Orders */}
                <div className="flex items-center gap-3 pt-2">
                  <div className="flex items-center gap-1 bg-accent-gold-soft px-2.5 py-1 rounded border border-accent-gold/30">
                    <div className="flex text-amber-500">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                      ))}
                    </div>
                    <span className="font-bold text-xs text-on-surface ml-1">{product.rating}</span>
                  </div>
                  <span className="text-xs text-text-muted underline cursor-pointer">
                    {product.reviews_count} Reviews
                  </span>
                  <span className="text-border-light">•</span>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                    🔥 340+ Orders Placed
                  </span>
                </div>
              </div>

              {/* Price Engine Box */}
              <div className="bg-surface-subtle p-space-base rounded-xl border border-border-light flex flex-col gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-2xl sm:text-3xl font-bold text-primary">
                    ৳ {product.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  {product.original_price > product.price && (
                    <span className="text-sm text-text-muted line-through">
                      ৳ {product.original_price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  {product.discount_percent > 0 && (
                    <span className="bg-badge-discount/10 text-badge-discount font-bold text-xs px-2.5 py-1 rounded">
                      Save ৳ {(product.original_price - product.price).toFixed(0)} ({product.discount_percent}% Off)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>All inclusive pricing. Cash on delivery eligible across 64 districts.</span>
                </div>
              </div>

              {/* Color Swatch Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display text-xs uppercase text-primary font-bold">
                    Color: <span className="text-text-muted font-normal">{selectedColor}</span>
                  </span>
                  <span className="text-xs text-text-muted">{product.colors.length} Colorways</span>
                </div>
                <div className="flex items-center gap-3">
                  {product.colors.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSelectedColor(c.name)}
                      className={`relative p-0.5 rounded-full border-2 transition-all ${
                        selectedColor === c.name ? "border-primary scale-110 shadow-sm" : "border-transparent hover:border-border-light"
                      }`}
                      title={c.name}
                    >
                      <span
                        className="block w-7 h-7 rounded-full shadow-inner border border-black/10"
                        style={{ backgroundColor: c.hex }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Size Selector Matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-display text-xs uppercase text-primary font-bold">
                    Select Size (Chest): <span className="text-secondary font-bold">{selectedSize} ({currentSizeObj?.chest}&quot;)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSizeModalOpen(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent-gold transition-colors"
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    <u>Size Guide</u>
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {product.sizes.map((s) => {
                    const isSelected = selectedSize === s.size;
                    return (
                      <button
                        key={s.size}
                        type="button"
                        disabled={s.stock === 0}
                        onClick={() => setSelectedSize(s.size)}
                        className={`py-3 px-2 rounded-lg text-center transition-all border ${
                          isSelected
                            ? "bg-primary text-white border-primary shadow-sm"
                            : "bg-surface-card border-border-light hover:border-primary text-on-surface"
                        } disabled:opacity-30 disabled:cursor-not-allowed`}
                      >
                        <div className="font-bold text-sm">{s.size}</div>
                        <div className={`text-[10px] ${isSelected ? "text-on-primary-container" : "text-text-muted"}`}>
                          Chest {s.chest}&quot;
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Stock Warning */}
                {availableStock <= 10 && availableStock > 0 && (
                  <div className="flex items-center gap-2 text-xs text-badge-discount font-medium bg-badge-discount/10 px-3 py-1.5 rounded-lg mt-2">
                    <AlertCircle className="w-4 h-4 animate-pulse shrink-0" />
                    <span>
                      Hurry! Only <strong className="font-bold">{availableStock}</strong> units remaining in Size <strong className="font-bold">{selectedSize}</strong>.
                    </span>
                  </div>
                )}
              </div>

              {/* Quantity Selector & CTAs */}
              <div className="flex flex-col gap-2.5 pt-2">
                <div className="flex items-center gap-3">
                  {/* Quantity Stepper */}
                  <div className="flex items-center bg-surface-subtle rounded-lg border border-border-light h-12 w-32 shrink-0">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="w-10 h-full flex items-center justify-center text-on-surface hover:text-primary"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-12 text-center font-bold text-sm text-primary">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQuantity(Math.min(availableStock, quantity + 1))}
                      className="w-10 h-full flex items-center justify-center text-on-surface hover:text-primary"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Add to Cart CTA */}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="flex-1 h-12 bg-primary hover:bg-primary-container text-white font-display text-xs uppercase tracking-wider font-bold rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>ADD TO CART • ৳ {(product.price * quantity).toLocaleString()}</span>
                  </button>
                </div>

                {/* Express Buy Now CTA */}
                <button
                  type="button"
                  onClick={handleBuyNow}
                  className="w-full h-12 bg-accent-gold hover:bg-[#b58b32] text-white font-display text-xs uppercase tracking-wider font-bold rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
                >
                  <Zap className="w-4 h-4" />
                  <span>BUY NOW (EXPRESS CHECKOUT)</span>
                </button>
              </div>

              {/* Delivery ETA & Guarantee */}
              <div className="bg-surface-card rounded-xl p-space-md border border-border-light flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface-subtle flex items-center justify-center text-primary shrink-0">
                    <Truck className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="font-bold text-xs text-primary block">
                      Fast Domestic Dispatch
                    </span>
                    <p className="text-xs text-text-muted mt-0.5">
                      <strong className="text-on-surface font-semibold">Dhaka Metro:</strong> 24-48 Hours | <strong className="text-on-surface font-semibold">Outside Dhaka:</strong> 3-5 Days
                    </p>
                    <span className="text-xs text-emerald-700 font-semibold mt-1 block">
                      ✓ Cash on Delivery (COD) Available
                    </span>
                  </div>
                </div>

                <div className="border-t border-border-light pt-3 grid grid-cols-2 gap-2 text-xs text-on-surface-variant">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="w-4 h-4 text-accent-gold shrink-0" />
                    <span>7 Days Doorstep Return</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-accent-gold shrink-0" />
                    <span>100% Genuine Apparel</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Size Guide Modal */}
      {sizeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-border-light mb-4">
              <h3 className="font-display uppercase text-base font-bold text-primary">
                Size Measurement Guide
              </h3>
              <button
                onClick={() => setSizeModalOpen(false)}
                className="p-1 text-text-muted hover:text-primary"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-text-muted mb-4">
              All garment measurements are taken flat in inches (&quot;). For chest, measure across the fullest part from underarm to underarm.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border border-border-light">
                <thead className="bg-surface-subtle font-display uppercase">
                  <tr>
                    <th className="p-2.5 border-b border-border-light">Size</th>
                    <th className="p-2.5 border-b border-border-light">Chest (&quot;)</th>
                    <th className="p-2.5 border-b border-border-light">Length (&quot;)</th>
                    <th className="p-2.5 border-b border-border-light">Sleeve (&quot;)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  <tr>
                    <td className="p-2.5 font-bold">M</td>
                    <td className="p-2.5">39.0</td>
                    <td className="p-2.5">28.0</td>
                    <td className="p-2.5">8.0</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">L</td>
                    <td className="p-2.5">40.5</td>
                    <td className="p-2.5">29.0</td>
                    <td className="p-2.5">8.5</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">XL</td>
                    <td className="p-2.5">43.0</td>
                    <td className="p-2.5">30.0</td>
                    <td className="p-2.5">9.0</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">2XL</td>
                    <td className="p-2.5">45.0</td>
                    <td className="p-2.5">31.0</td>
                    <td className="p-2.5">9.5</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button
              onClick={() => setSizeModalOpen(false)}
              className="mt-6 w-full py-2.5 bg-primary text-white font-display uppercase text-xs font-bold rounded-lg"
            >
              Got it, close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
