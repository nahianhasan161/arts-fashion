import { Product, Category } from "@/types";
import { PRODUCTS, CATEGORIES } from "@/lib/data/mock-data";
import { supabase, isSupabaseConfigured } from "@/lib/supabase/client";

export async function getProducts(options?: {
  category?: string;
  subCategory?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  sortBy?: string;
  limit?: number;
}): Promise<Product[]> {
  // If Supabase is configured and reachable
  if (isSupabaseConfigured && supabase) {
    try {
      let query = supabase.from("products").select("*");

      if (options?.category && options.category !== "all") {
        query = query.eq("category", options.category);
      }
      if (options?.subCategory) {
        query = query.eq("sub_category", options.subCategory);
      }
      if (options?.minPrice !== undefined) {
        query = query.gte("price", options.minPrice);
      }
      if (options?.maxPrice !== undefined) {
        query = query.lte("price", options.maxPrice);
      }

      if (options?.sortBy === "price_asc") {
        query = query.order("price", { ascending: true });
      } else if (options?.sortBy === "price_desc") {
        query = query.order("price", { ascending: false });
      } else if (options?.sortBy === "popular") {
        query = query.order("reviews_count", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data as Product[];
      }
    } catch (err) {
      console.warn("Supabase fetch failed, falling back to local dataset:", err);
    }
  }

  // Local in-memory filtering fallback
  let items = [...PRODUCTS];

  if (options?.category && options.category !== "all") {
    items = items.filter(
      (p) => p.category.toLowerCase() === options.category?.toLowerCase()
    );
  }

  if (options?.subCategory) {
    items = items.filter(
      (p) => p.sub_category?.toLowerCase() === options.subCategory?.toLowerCase()
    );
  }

  if (options?.minPrice !== undefined) {
    items = items.filter((p) => p.price >= (options.minPrice || 0));
  }

  if (options?.maxPrice !== undefined) {
    items = items.filter((p) => p.price <= (options.maxPrice || Infinity));
  }

  if (options?.sizes && options.sizes.length > 0) {
    items = items.filter((p) =>
      p.sizes.some((s) => options.sizes?.includes(s.size))
    );
  }

  if (options?.sortBy === "price_asc") {
    items.sort((a, b) => a.price - b.price);
  } else if (options?.sortBy === "price_desc") {
    items.sort((a, b) => b.price - a.price);
  } else if (options?.sortBy === "popular") {
    items.sort((a, b) => b.reviews_count - a.reviews_count);
  }

  if (options?.limit) {
    items = items.slice(0, options.limit);
  }

  return items;
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("slug", slug)
        .single();
      if (!error && data) {
        return data as Product;
      }
    } catch (err) {
      console.warn("Supabase getProductBySlug error, using fallback:", err);
    }
  }

  const found = PRODUCTS.find((p) => p.slug === slug);
  return found || null;
}

export async function getFeaturedProducts(): Promise<Product[]> {
  return getProducts({ limit: 6 });
}

export async function getCategories(): Promise<Category[]> {
  return CATEGORIES;
}
