"use client";

import React, { useState } from "react";
import { Filter, X, ChevronUp, ChevronDown } from "lucide-react";
import { useFilterStore } from "@/lib/store/filter-store";
import { CATEGORIES } from "@/lib/data/mock-data";

interface FilterSidebarProps {
  onCloseMobile?: () => void;
}

export function FilterSidebar({ onCloseMobile }: FilterSidebarProps) {
  const {
    category,
    subCategory,
    selectedSizes,
    minPrice,
    maxPrice,
    inStockOnly,
    setCategory,
    setSubCategory,
    toggleSize,
    setPriceRange,
    toggleInStock,
    resetFilters,
  } = useFilterStore();

  const [categoryOpen, setCategoryOpen] = useState(true);
  const [priceOpen, setPriceOpen] = useState(true);
  const [sizeOpen, setSizeOpen] = useState(true);
  const allCategories = CATEGORIES;

  const sizesList = [
    { size: "XS", count: 14 },
    { size: "S", count: 38 },
    { size: "M", count: 54 },
    { size: "L", count: 62 },
    { size: "XL", count: 45 },
    { size: "XXL", count: 29 },
    { size: "3XL", count: 12 },
  ];

  const hasActiveFilters =
    category !== "all" ||
    subCategory !== "" ||
    selectedSizes.length > 0 ||
    maxPrice < 5500 ||
    inStockOnly;

  return (
    <aside className="w-full flex flex-col gap-space-base">
      {/* 1. Active Filters Box */}
      {hasActiveFilters && (
        <div className="bg-surface-card p-space-base rounded-lg border border-border-light shadow-sm flex flex-col gap-space-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-primary" />
              <span className="font-display uppercase tracking-wider text-xs font-bold text-primary">
                Active Filters
              </span>
            </div>
            <button
              onClick={resetFilters}
              className="text-[11px] font-bold text-badge-discount hover:underline uppercase"
            >
              Clear All
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {category !== "all" && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-surface-subtle text-primary border border-border-light rounded text-xs">
                <span>Category: {category}</span>
                <button onClick={() => setCategory("all")}>
                  <X className="w-3 h-3 hover:text-badge-discount" />
                </button>
              </span>
            )}

            {subCategory && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-surface-subtle text-primary border border-border-light rounded text-xs">
                <span>{subCategory}</span>
                <button onClick={() => setSubCategory("")}>
                  <X className="w-3 h-3 hover:text-badge-discount" />
                </button>
              </span>
            )}

            {selectedSizes.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2 py-1 bg-surface-subtle text-primary border border-border-light rounded text-xs"
              >
                <span>Size: {s}</span>
                <button onClick={() => toggleSize(s)}>
                  <X className="w-3 h-3 hover:text-badge-discount" />
                </button>
              </span>
            ))}

            {maxPrice < 5500 && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-surface-subtle text-primary border border-border-light rounded text-xs">
                <span>Up to ৳ {maxPrice}</span>
                <button onClick={() => setPriceRange(150, 5500)}>
                  <X className="w-3 h-3 hover:text-badge-discount" />
                </button>
              </span>
            )}

            {inStockOnly && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-secondary-fixed text-on-surface rounded text-xs font-medium">
                <span>In Stock Only</span>
                <button onClick={toggleInStock}>
                  <X className="w-3 h-3 hover:text-badge-discount" />
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Category Tree Accordion */}
      <div className="bg-surface-card p-space-base rounded-lg border border-border-light shadow-sm flex flex-col gap-2">
        <button
          onClick={() => setCategoryOpen(!categoryOpen)}
          className="w-full flex items-center justify-between font-display text-xs font-bold uppercase tracking-wider text-primary"
        >
          <span>Category Tree</span>
          {categoryOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>

        {categoryOpen && (
          <div className="flex flex-col gap-3 pt-2 text-xs">
            {allCategories.map((item) => (
              <label
                key={item.id}
                className="flex items-center justify-between py-1 cursor-pointer hover:text-primary transition-colors text-on-surface-variant"
              >
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={subCategory === item.name}
                    onChange={() => {
                      setSubCategory(subCategory === item.name ? "" : item.name);
                    }}
                    className="w-3.5 h-3.5 rounded text-primary focus:ring-0 border-border-light"
                  />
                  <span>{item.name}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* 3. Price Range (BDT) Slider */}
      <div className="bg-surface-card p-space-base rounded-lg border border-border-light shadow-sm flex flex-col gap-2">
        <button
          onClick={() => setPriceOpen(!priceOpen)}
          className="w-full flex items-center justify-between font-display text-xs font-bold uppercase tracking-wider text-primary"
        >
          <span>Price Range (BDT)</span>
          {priceOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>

        {priceOpen && (
          <div className="pt-2">
            <div className="flex justify-between text-xs font-semibold text-secondary mb-2">
              <span>৳ 150</span>
              <span className="font-bold text-primary">৳ {maxPrice}</span>
              <span>৳ 5,500</span>
            </div>

            <input
              type="range"
              min={150}
              max={5500}
              step={50}
              value={maxPrice}
              onChange={(e) => setPriceRange(minPrice, Number(e.target.value))}
              className="w-full h-1.5 bg-surface-container rounded-lg appearance-none cursor-pointer accent-primary"
            />

            <div className="flex items-center justify-between gap-2 mt-3 text-xs">
              <div className="flex-1 bg-surface-subtle px-2 py-1.5 rounded border border-border-light">
                <span className="text-[10px] text-text-muted block">Min</span>
                <span className="font-bold text-primary">৳ 150</span>
              </div>
              <span className="text-text-muted">-</span>
              <div className="flex-1 bg-surface-subtle px-2 py-1.5 rounded border border-border-light">
                <span className="text-[10px] text-text-muted block">Max</span>
                <span className="font-bold text-primary">৳ {maxPrice}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. Filter by Size */}
      <div className="bg-surface-card p-space-base rounded-lg border border-border-light shadow-sm flex flex-col gap-2">
        <button
          onClick={() => setSizeOpen(!sizeOpen)}
          className="w-full flex items-center justify-between font-display text-xs font-bold uppercase tracking-wider text-primary"
        >
          <span>Filter by Size</span>
          {sizeOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </button>

        {sizeOpen && (
          <div className="grid grid-cols-4 gap-1.5 pt-2">
            {sizesList.map((s) => {
              const active = selectedSizes.includes(s.size);
              return (
                <button
                  key={s.size}
                  onClick={() => toggleSize(s.size)}
                  className={`py-2 rounded text-xs font-bold transition-all text-center border ${
                    active
                      ? "bg-primary text-white border-primary shadow-sm"
                      : "bg-surface-subtle hover:bg-surface-container text-on-surface border-border-light"
                  }`}
                >
                  <div>{s.size}</div>
                  <span
                    className={`block text-[9px] font-normal ${
                      active ? "text-on-primary-container" : "text-text-muted"
                    }`}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. In-Stock Filter */}
      <div className="bg-surface-card p-space-base rounded-lg border border-border-light shadow-sm flex items-center justify-between">
        <span className="font-display text-xs font-bold uppercase tracking-wider text-primary">
          In Stock Only
        </span>
        <button
          onClick={toggleInStock}
          className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
            inStockOnly ? "bg-primary" : "bg-surface-container"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform ${
              inStockOnly ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {onCloseMobile && (
        <button
          onClick={onCloseMobile}
          className="lg:hidden w-full py-3 bg-primary text-white font-display uppercase tracking-wider text-xs font-bold rounded-lg mt-2"
        >
          Apply Filters
        </button>
      )}
    </aside>
  );
}
