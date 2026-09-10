"use client";

import React, { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Home, ChevronRight, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { PRODUCTS } from "@/lib/data/mock-data";
import { ProductCard } from "@/components/product/ProductCard";
import { FilterSidebar } from "@/components/shop/FilterSidebar";
import { useFilterStore } from "@/lib/store/filter-store";

function ShopContent() {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const queryParam = searchParams.get("q");

  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  const {
    category,
    subCategory,
    selectedSizes,
    minPrice,
    maxPrice,
    sortBy,
    inStockOnly,
    setCategory,
    setSubCategory,
    setSortBy,
  } = useFilterStore();

  useEffect(() => {
    if (categoryParam) {
      setCategory(categoryParam);
    }
  }, [categoryParam, setCategory]);

  const filteredProducts = useMemo(() => {
    let list = [...PRODUCTS];

    if (queryParam) {
      const q = queryParam.toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.sub_category?.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }

    if (category && category !== "all") {
      list = list.filter((p) => p.category.toLowerCase() === category.toLowerCase());
    }

    if (subCategory) {
      list = list.filter((p) => p.sub_category?.toLowerCase() === subCategory.toLowerCase());
    }

    if (selectedSizes.length > 0) {
      list = list.filter((p) =>
        p.sizes.some((s) => selectedSizes.includes(s.size))
      );
    }

    list = list.filter((p) => p.price >= minPrice && p.price <= maxPrice);

    if (inStockOnly) {
      list = list.filter((p) => p.stock > 0);
    }

    if (sortBy === "price_asc") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === "popular") {
      list.sort((a, b) => b.reviews_count - a.reviews_count);
    }

    return list;
  }, [queryParam, category, subCategory, selectedSizes, minPrice, maxPrice, sortBy, inStockOnly]);

  const quickChips = [
    { label: "All Men", action: () => { setCategory("all"); setSubCategory(""); } },
    { label: "Half Sleeve T-Shirts", action: () => setSubCategory("Half Sleeve T-Shirts") },
    { label: "Designer Polos", action: () => setSubCategory("Polo T-Shirts") },
    { label: "Luxury Panjabi", action: () => setSubCategory("Luxury Panjabi") },
    { label: "Trousers & Joggers", action: () => setSubCategory("Comfy & Active Trousers") },
    { label: "Denim & Chinos", action: () => setSubCategory("Denim Jeans & Cargo") },
    { label: "Sports Editions", action: () => setSubCategory("Sports Editions") },
  ];

  return (
    <div className="w-full pb-space-3xl">
      {/* 1. Breadcrumbs & Category Hero Strip */}
      <section className="w-full bg-surface-card border-b border-border-light">
        <div className="max-w-container-max mx-auto px-space-base py-space-md">
          {/* Breadcrumb Hierarchy */}
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-text-muted mb-3">
            <Link href="/" className="hover:text-primary transition-colors flex items-center gap-1">
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </Link>
            <ChevronRight className="w-3 h-3 opacity-40" />
            <Link href="/shop" className="hover:text-primary transition-colors">
              Shop
            </Link>
            <ChevronRight className="w-3 h-3 opacity-40" />
            <span className="font-bold text-primary capitalize">
              {category === "all" ? "Curated Collection" : `${category}'s Collection`}
            </span>
          </nav>

          {/* Category Title & Metrics */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl sm:text-3xl uppercase text-primary tracking-wide font-bold">
                  {category === "all" ? "MEN'S APPAREL & COLLECTION" : `${category.toUpperCase()}'S APPAREL & COLLECTION`}
                </h1>
                <span className="bg-primary text-white text-[10px] font-display font-bold px-2 py-0.5 rounded uppercase">
                  2025 Edition
                </span>
              </div>
              <p className="text-xs sm:text-sm text-text-muted mt-1 max-w-2xl">
                Engineered with certified combed compact organic cotton, tailored precision, and modern street aesthetics. Handcrafted for daylong comfort in tropical weather.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-text-muted bg-surface-subtle px-3 py-1.5 rounded-lg border border-border-light self-start md:self-auto">
              <span className="w-2 h-2 rounded-full bg-secondary-container"></span>
              <span>
                Showing <strong className="text-on-surface font-bold">1–{filteredProducts.length}</strong> of{" "}
                <strong className="text-on-surface font-bold">148</strong> curated products
              </span>
            </div>
          </div>

          {/* Quick Sub-Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 pb-1 -mx-space-base px-space-base md:mx-0 md:px-0">
            {quickChips.map((chip) => {
              const active =
                (chip.label === "All Men" && !subCategory && category === "all") ||
                subCategory === chip.label ||
                (chip.label === "Designer Polos" && subCategory === "Polo T-Shirts") ||
                (chip.label === "Trousers & Joggers" && subCategory === "Comfy & Active Trousers") ||
                (chip.label === "Denim & Chinos" && subCategory === "Denim Jeans & Cargo");

              return (
                <button
                  key={chip.label}
                  onClick={chip.action}
                  className={`px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider font-semibold whitespace-nowrap transition-colors border ${
                    active
                      ? "bg-primary text-white border-primary shadow-sm"
                      : "bg-surface-subtle hover:bg-surface-container text-on-surface border-border-light"
                  }`}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. Editorial Spotlight Promo Banner */}
      <section className="max-w-container-max mx-auto px-space-base mt-space-md w-full">
        <div className="relative bg-primary-container text-white rounded-xl overflow-hidden shadow-md flex flex-col md:flex-row items-stretch">
          <div className="flex-1 p-space-lg md:p-space-xl flex flex-col justify-center relative z-10">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 bg-secondary text-white rounded text-[10px] font-display font-bold uppercase tracking-widest">
                LIMITED DROP
              </span>
              <span className="text-secondary-fixed text-xs font-display uppercase font-bold tracking-wider">
                WORLD CUP SPECIAL RELEASE
              </span>
            </div>
            <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-wide leading-tight font-bold">
              OFFICIAL & FAN EDITION KITS
            </h2>
            <p className="text-on-primary-container text-xs sm:text-sm max-w-md mt-1 mb-4">
              Engineered lightweight moisture-wicking honeycomb Jacquard knit fabric. Official emblem detailing with reinforced 4-way stretch seams.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSubCategory("Sports Editions")}
                className="px-5 py-2.5 bg-secondary hover:bg-secondary-container hover:text-primary text-white font-display text-xs uppercase font-bold rounded transition-colors shadow-sm"
              >
                Shop Jerseys (৳ 1,290)
              </button>
              <span className="text-on-primary-container text-xs hidden sm:inline">
                Cash on delivery available nationwide
              </span>
            </div>
          </div>
          <div className="w-full md:w-1/2 relative min-h-[160px] md:min-h-[200px] bg-primary">
            <Image
              src="https://lh3.googleusercontent.com/aida/AEtjO1XtRs88VSBzdbMWQYRQuAY8CMk93-FpKuVlyb4a4idBDt95ROa-QuuKBaeOYjyhts6byy9S6RakXa0MkP45VJRbQ2P5ixraZTP7wBi2v4OfPwjYGUGEM0LLf24iv1Tpqz9ttMJnPF8M7Ka-yBomlyibQgY5rAYEVXaEn_pW9_nDIrkpdg5QXdDvVKNk968t2nuHE0zqs7YctPeS0kASeelv_7Pw3pI9gAFWPOAfM88aUoQ_7RVNdLPX6cs"
              alt="Official Match Edition Jersey"
              fill
              className="object-cover opacity-90 hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-primary-container via-transparent to-transparent hidden md:block" />
          </div>
        </div>
      </section>

      {/* 3. Main Catalog Shell: Sidebar + Product Grid */}
      <section className="max-w-container-max mx-auto px-space-base py-space-lg w-full">
        <div className="flex flex-col lg:flex-row gap-space-xl items-start">
          {/* Desktop Filter Sidebar */}
          <div className="hidden lg:block w-[280px] shrink-0">
            <FilterSidebar />
          </div>

          {/* Right Product Grid Area */}
          <div className="flex-1 w-full">
            {/* Action Bar (Mobile Filter Trigger & Sort) */}
            <div className="bg-surface-card p-3 rounded-lg border border-border-light shadow-sm mb-space-base flex items-center justify-between">
              <button
                onClick={() => setMobileFilterOpen(true)}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 bg-surface-subtle hover:bg-surface-container rounded-md text-xs font-bold font-display uppercase tracking-wider text-primary border border-border-light"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Filters & Specs</span>
              </button>

              <div className="text-xs text-text-muted hidden sm:block">
                Showing <strong className="text-primary font-bold">{filteredProducts.length}</strong> items
              </div>

              {/* Sort By Dropdown */}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-text-muted font-medium flex items-center gap-1">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>Sort by:</span>
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-surface-subtle border border-border-light text-primary text-xs font-bold rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="newest">Newest Arrivals</option>
                  <option value="popular">Best Selling / Popular</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                </select>
              </div>
            </div>

            {/* Products Grid */}
            {filteredProducts.length === 0 ? (
              <div className="bg-surface-card rounded-xl border border-border-light p-12 text-center flex flex-col items-center justify-center">
                <h3 className="font-display text-lg uppercase font-bold text-primary mb-1">
                  No products found
                </h3>
                <p className="text-xs text-text-muted max-w-sm mb-4">
                  We couldn&apos;t find any apparel matching your active filters. Try adjusting your size or price range.
                </p>
                <button
                  onClick={() => {
                    setCategory("all");
                    setSubCategory("");
                  }}
                  className="px-5 py-2 bg-primary text-white font-display text-xs uppercase font-bold rounded-md"
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-space-sm sm:gap-space-md">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Mobile Filter Modal */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileFilterOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-xs bg-surface-card p-4 overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-border-light mb-4">
                <h3 className="font-display uppercase text-sm font-bold text-primary">
                  Filter Products
                </h3>
                <button
                  onClick={() => setMobileFilterOpen(false)}
                  className="p-1 text-text-muted hover:text-primary"
                >
                  ✕
                </button>
              </div>
              <FilterSidebar onCloseMobile={() => setMobileFilterOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShopPage() {
  return (
    <React.Suspense
      fallback={
        <div className="max-w-container-max mx-auto px-space-base py-24 text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-3 text-xs text-text-muted font-display uppercase tracking-wider">
            Loading collection...
          </p>
        </div>
      }
    >
      <ShopContent />
    </React.Suspense>
  );
}
