import { create } from "zustand";

interface FilterState {
  category: string;
  subCategory: string;
  selectedSizes: string[];
  minPrice: number;
  maxPrice: number;
  sortBy: string;
  inStockOnly: boolean;

  setCategory: (category: string) => void;
  setSubCategory: (subCategory: string) => void;
  toggleSize: (size: string) => void;
  setPriceRange: (min: number, max: number) => void;
  setSortBy: (sortBy: string) => void;
  toggleInStock: () => void;
  resetFilters: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  category: "all",
  subCategory: "",
  selectedSizes: [],
  minPrice: 150,
  maxPrice: 5500,
  sortBy: "newest",
  inStockOnly: false,

  setCategory: (category) => set({ category, subCategory: "" }),
  setSubCategory: (subCategory) => set({ subCategory }),
  toggleSize: (size) =>
    set((state) => ({
      selectedSizes: state.selectedSizes.includes(size)
        ? state.selectedSizes.filter((s) => s !== size)
        : [...state.selectedSizes, size],
    })),
  setPriceRange: (minPrice, maxPrice) => set({ minPrice, maxPrice }),
  setSortBy: (sortBy) => set({ sortBy }),
  toggleInStock: () => set((state) => ({ inStockOnly: !state.inStockOnly })),
  resetFilters: () =>
    set({
      category: "all",
      subCategory: "",
      selectedSizes: [],
      minPrice: 150,
      maxPrice: 5500,
      sortBy: "newest",
      inStockOnly: false,
    }),
}));
