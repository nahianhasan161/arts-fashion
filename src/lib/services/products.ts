import { Product, Category } from "@/types";
import { PRODUCTS, CATEGORIES } from "@/lib/data/mock-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

async function getActiveSupabaseClient(): Promise<SupabaseClient | null> {
  if (typeof window === "undefined") {
    // Dynamically import to avoid bundling next/headers in client components
    try {
      const { getSupabaseServerClient } = await import("@/lib/supabase/server");
      return await getSupabaseServerClient();
    } catch {
      return null;
    }
  }
  return getSupabaseBrowserClient();
}

export async function getProducts(options?: {
  category?: string;
  subCategory?: string;
  minPrice?: number;
  maxPrice?: number;
  sizes?: string[];
  tags?: string[];
  search?: string;
  sortBy?: string;
  limit?: number;
}): Promise<Product[]> {
  // If Supabase is configured and reachable
  const supabase = await getActiveSupabaseClient();
  if (supabase) {
    try {
      let query = supabase.from("products").select("*");

      // A shopper may only ever see rows that are both live and on sale. This
      // was not filtered at all before, so every draft an admin saved was
      // immediately browseable and purchasable, and a retired product stayed
      // on sale after an admin deleted it. Both predicates are indexed
      // (products_live_idx, products_status_idx) so this is not a scan.
      query = query.is("deleted_at", null).eq("status", "published");

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
      // Overlap, not equality: a product tagged ["summer","linen"] matches a
      // shopper looking for "summer". PostgREST's `cs` is `&&`.
      if (options?.tags && options.tags.length > 0) {
        query = query.filter("tags", "cs", options.tags);
      }
      if (options?.search) {
        // Title and the plain-text summary only. `description` is rich HTML
        // and matching inside markup produces hits on attribute names.
        const term = options.search.replace(/[,%()]/g, " ").trim();
        if (term) {
          query = query.or(
            `title.ilike.%${term}%,short_description.ilike.%${term}%`
          );
        }
      }

      if (options?.sortBy === "price_asc") {
        query = query.order("price", { ascending: true });
      } else if (options?.sortBy === "price_desc") {
        query = query.order("price", { ascending: false });
      } else if (options?.sortBy === "popular") {
        query = query.order("reviews_count", { ascending: false });
      } else if (options?.sortBy === "newest") {
        // published_at, not created_at. created_at is when the row was typed
        // in, so a product drafted for three weeks and published on a
        // Thursday would otherwise appear three weeks old here. Falls back to
        // created_at only if published_at is somehow null, which the trigger
        // does not allow for a published row.
        query = query
          .order("published_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;
      // An empty result is a real answer, not a failure. The `data.length > 0`
      // test that used to sit here meant that searching for a term with no
      // matches, or asking for a category that is genuinely empty, silently
      // substituted the entire mock catalogue — so a shopper who found nothing
      // was shown products that do not exist. Empty is returned; only a thrown
      // error or a missing client reaches the fallback below.
      if (!error) {
        return (data ?? []) as Product[];
      }
      console.warn("Supabase query failed, falling back to local dataset:", error.message);
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
  const supabase = await getActiveSupabaseClient();
  if (supabase) {
    try {
      // The same two predicates as getProducts(). Without them a draft or a
      // retired product still had a working detail page and could be added to
      // the cart, which is the exact gap the soft delete was added to close.
      // A miss here is a 404, not a reason to show mock data: the mock list
      // does not contain this slug, and falling through to it would 200 a
      // product the caller believes exists in the database.
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("slug", slug)
        .is("deleted_at", null)
        .eq("status", "published")
        .maybeSingle();
      if (!error) {
        return (data as Product) ?? null;
      }
      console.warn("Supabase getProductBySlug error, using fallback:", error.message);
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
