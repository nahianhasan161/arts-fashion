"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Image as ImageIcon,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { ProductFormModal } from "@/components/admin/products/ProductFormModal";
import { flattenCategoryTree } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PRODUCT_GENDERS,
  PRODUCT_GENDER_LABELS,
  type Category,
  type ColorOption,
  type Product,
  type ProductGender,
  type ProductStatus,
  type Promotion,
  type SizeLabel,
} from "@/types";

/**
 * Every filter the table offers, in one object.
 *
 * Grouped like this rather than as a dozen separate useState hooks because
 * they travel together: they all belong in the same query string, they all
 * reset together when the filters are cleared, and the reset button is only
 * correct if "cleared" means one assignment.
 */
interface Filters {
  search: string;
  gender: string;
  category_id: string;
  sub_category_id: string;
  status: string;
  featured: string;
  stock_state: string;
  min_price: string;
  max_price: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  gender: "",
  category_id: "",
  sub_category_id: "",
  status: "",
  featured: "",
  stock_state: "",
  min_price: "",
  max_price: "",
};

/** Sort keys, matching the allow-list the API route enforces. */
const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently updated" },
  { value: "title_asc", label: "Title A–Z" },
  { value: "title_desc", label: "Title Z–A" },
  { value: "price_asc", label: "Price low–high" },
  { value: "price_desc", label: "Price high–low" },
  { value: "stock_asc", label: "Stock low–high" },
  { value: "stock_desc", label: "Stock high–low" },
] as const;

const PAGE_SIZE = 20;

/** Must match LOW_STOCK in the API route, or the label and the filter disagree. */
const LOW_STOCK = 5;

const STATUS_STYLES: Record<ProductStatus, string> = {
  published: "bg-green-100 text-green-700",
  draft: "bg-surface-container text-text-muted",
  archived: "bg-surface-container text-text-muted",
};

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; pages: number };
  sort?: string;
  error?: string;
}

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string>("newest");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // What the search box holds, and what has been sent to the server. Searching
  // on every keystroke fires a query per character; this waits for a pause.
  const [searchDraft, setSearchDraft] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [colors, setColors] = useState<ColorOption[]>([]);
  const [colorsLoading, setColorsLoading] = useState(true);
  const [sizes, setSizes] = useState<SizeLabel[]>([]);
  const [sizesLoading, setSizesLoading] = useState(true);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promotionsLoading, setPromotionsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchCategories = async () => {
    setCategoriesLoading(true);
    try {
      const response = await fetch("/api/admin/categories?limit=100");
      const data: ApiResponse<Category> = await response.json();
      if (response.ok) {
        setCategories(flattenCategoryTree(data.data ?? []));
      }
    } catch {
      // Ignore category fetch errors
    } finally {
      setCategoriesLoading(false);
    }
  };

  const fetchColors = async () => {
    setColorsLoading(true);
    try {
      const response = await fetch("/api/admin/colors?limit=100");
      const data: ApiResponse<ColorOption> = await response.json();
      if (response.ok) {
        setColors(data.data ?? []);
      }
    } catch {
      // Ignore color fetch errors
    } finally {
      setColorsLoading(false);
    }
  };

  const fetchSizes = async () => {
    setSizesLoading(true);
    try {
      const response = await fetch("/api/admin/sizes?limit=100");
      const data: ApiResponse<SizeLabel> = await response.json();
      if (response.ok) {
        setSizes(data.data ?? []);
      }
    } catch {
      // Ignore size fetch errors
    } finally {
      setSizesLoading(false);
    }
  };

  const fetchPromotions = async () => {
    setPromotionsLoading(true);
    try {
      const response = await fetch("/api/admin/promotions?limit=100");
      const data: ApiResponse<Promotion> = await response.json();
      if (response.ok) {
        setPromotions(data.data);
      }
    } catch {
      // Ignore promotion fetch errors
    } finally {
      setPromotionsLoading(false);
    }
  };

  /**
   * The whole filtering and sorting story is this query string.
   *
   * It used to fetch one page of 100 and filter that page in the browser, on
   * title and slug only. So a product could not be found by SKU, category or
   * audience, and anything past the hundredth was unreachable by any search at
   * all. Building the query here means the server decides what matches, and
   * the count that comes back is the count of everything that matches.
   *
   * Empty values are omitted rather than sent as blanks, so the URL stays
   * readable and an unset filter cannot be mistaken for a filter on "".
   */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      params.set("sort", sort);
      for (const [key, value] of Object.entries(filters)) {
        if (value !== "") params.set(key, value);
      }

      const response = await fetch(`/api/admin/products?${params.toString()}`);
      const data: ApiResponse<Product> = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load products");
      }

      setProducts(data.data ?? []);
      setTotal(data.pagination?.total ?? 0);
      setPages(data.pagination?.pages ?? 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load products"
      );
    } finally {
      setLoading(false);
    }
  }, [filters, page, sort]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Debounce the search box into the filters object.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft }));
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    // Any filter change invalidates the current page number: page 7 of the
    // old result set is meaningless against the new one, and leaving it there
    // is how a filtered table ends up showing an empty page with rows in it.
    setPage(1);
  };

  // The option lists are reference data, not a function of the filters, so
  // they are loaded once rather than on every keystroke.
  useEffect(() => {
    fetchCategories();
    fetchColors();
    fetchSizes();
    fetchPromotions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parents = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const subCategories = useMemo(
    () => categories.filter((c) => !!c.parent_id && c.parent_id === filters.category_id),
    [categories, filters.category_id]
  );

  const activeFilterCount = useMemo(
    () => Object.entries(filters).filter(([key, v]) => v !== "" && key !== "search").length,
    [filters]
  );

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchDraft("");
    setPage(1);
  };

  const openCreateModal = () => {
    setEditingProduct(null);
    setShowModal(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingProduct(null);
  };

  const deleteProduct = async (id: string) => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/products?id=${id}`, {
        method: "DELETE",
      });
      const data: { error?: string } = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete product");
      }

      setDeleteConfirmId(null);
      // Reloaded rather than spliced out of local state: the row is still there,
      // marked retired, and it leaves the list because of the deleted_at filter
      // the server applies. Removing it client-side too would make the row
      // disappear before the count could update.
      fetchProducts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete product"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const filterControl =
    "h-9 px-3 text-sm border border-border-light rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-primary/20";

  return (
    <div className="space-y-4">
      {/* Toolbar: search, sort, filters, add */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search title, slug, SKU, category…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-border-light rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort products"
          className={filterControl}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className={`inline-flex items-center gap-2 h-9 px-3 text-sm font-semibold border rounded-lg transition-colors ${
            activeFilterCount > 0
              ? "border-primary text-primary bg-primary/5"
              : "border-border-light text-text-muted hover:bg-surface-subtle"
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="px-1.5 rounded-full bg-primary text-white text-[11px] leading-4">
              {activeFilterCount}
            </span>
          )}
        </button>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 h-9 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="bg-surface-card border border-border-light rounded-xl p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Gender / Age
              </label>
              <select
                value={filters.gender}
                onChange={(e) => setFilter("gender", e.target.value)}
                className={`${filterControl} w-full`}
              >
                <option value="">Any</option>
                {PRODUCT_GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {PRODUCT_GENDER_LABELS[g]}
                  </option>
                ))}
                {/* A bucket of its own: "not assigned" is a real state and the
                    only way to find the products an admin still needs to sort. */}
                <option value="none">Not assigned</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Category
              </label>
              <select
                value={filters.category_id}
                onChange={(e) => {
                  // Clearing the parent clears the child with it. Left alone,
                  // a sub-category from the previous parent would stay selected
                  // and match nothing, and the table would look broken.
                  setFilters((f) => ({
                    ...f,
                    category_id: e.target.value,
                    sub_category_id: "",
                  }));
                  setPage(1);
                }}
                disabled={categoriesLoading}
                className={`${filterControl} w-full`}
              >
                <option value="">Any</option>
                {parents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Sub-category
              </label>
              <select
                value={filters.sub_category_id}
                onChange={(e) => setFilter("sub_category_id", e.target.value)}
                disabled={!filters.category_id || categoriesLoading}
                className={`${filterControl} w-full disabled:bg-surface-subtle disabled:text-text-muted`}
              >
                <option value="">
                  {filters.category_id ? "Any" : "Choose a category first"}
                </option>
                {subCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                value={filters.status}
                onChange={(e) => setFilter("status", e.target.value)}
                className={`${filterControl} w-full`}
              >
                <option value="">Any</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Stock
              </label>
              <select
                value={filters.stock_state}
                onChange={(e) => setFilter("stock_state", e.target.value)}
                className={`${filterControl} w-full`}
              >
                <option value="">Any</option>
                <option value="in">In stock</option>
                <option value="low">Low ({`1–${LOW_STOCK}`})</option>
                <option value="out">Out of stock</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Featured
              </label>
              <select
                value={filters.featured}
                onChange={(e) => setFilter("featured", e.target.value)}
                className={`${filterControl} w-full`}
              >
                <option value="">Any</option>
                <option value="1">Featured only</option>
                <option value="0">Not featured</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Min price
              </label>
              <input
                type="number"
                min={0}
                value={filters.min_price}
                onChange={(e) => setFilter("min_price", e.target.value)}
                placeholder="0"
                className={`${filterControl} w-full`}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Max price
              </label>
              <input
                type="number"
                min={0}
                value={filters.max_price}
                onChange={(e) => setFilter("max_price", e.target.value)}
                placeholder="Any"
                className={`${filterControl} w-full`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-light">
            <p className="text-xs text-text-muted">
              {loading ? "Searching…" : `Showing ${from}–${to} of ${total}`}
            </p>
            <button
              onClick={clearFilters}
              disabled={activeFilterCount === 0 && searchDraft === ""}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-primary disabled:opacity-40 disabled:hover:text-text-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear all filters
            </button>
          </div>
        </div>
      )}

      {/* Result count, visible whether or not the panel is open */}
      {!filtersOpen && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">
            {loading ? (
              "Loading…"
            ) : (
              <>
                Showing <span className="font-semibold text-on-surface">{from}–{to}</span> of{" "}
                <span className="font-semibold text-on-surface">{total}</span>{" "}
                {total === 1 ? "product" : "products"}
                {activeFilterCount > 0 && (
                  <span className="ml-2">({activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} applied)</span>
                )}
              </>
            )}
          </p>
          {(activeFilterCount > 0 || searchDraft !== "") && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-primary transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface-card border border-border-light rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Product
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Gender / Age
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Category
                </th>
                <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Price
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Stock
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Updated
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-light last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-10 h-10 rounded-lg" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Skeleton className="h-4 w-16 ml-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Skeleton className="h-6 w-14 rounded-full mx-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Skeleton className="h-5 w-16 rounded-full mx-auto" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Skeleton className="h-7 w-7 rounded" />
                        <Skeleton className="h-7 w-7 rounded" />
                        <Skeleton className="h-7 w-7 rounded" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <p className="text-text-muted text-sm">
                      {total === 0 && activeFilterCount > 0
                        ? "No products match these filters."
                        : "No products yet."}
                    </p>
                    {(activeFilterCount > 0 || searchDraft !== "") && (
                      <button
                        onClick={clearFilters}
                        className="mt-3 text-sm font-semibold text-primary hover:underline"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-border-light last:border-b-0 hover:bg-surface-subtle/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.images?.[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.images[0]}
                              alt=""
                              className="w-10 h-10 rounded object-cover shrink-0"
                            />
                        ) : (
                          <div className="w-10 h-10 bg-surface-subtle rounded flex items-center justify-center shrink-0">
                            <ImageIcon className="w-4 h-4 text-text-muted" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-on-surface text-sm truncate">
                            {product.title}
                          </p>
                          <p className="text-xs text-text-muted truncate">
                            {product.slug}
                          </p>
                          {/* Secondary facts that used to be invisible: an admin
                              could not tell a draft from a live product, nor
                              see whether a badge, promotion or variant matrix
                              existed, because none of it was in the table. */}
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {product.is_featured && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-gold/20 text-accent-gold font-semibold">
                                Featured
                              </span>
                            )}
                            {product.badge && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-text-muted">
                                {product.badge}
                              </span>
                            )}
                            {(product.variants?.length ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-text-muted">
                                {product.variants!.length} variant
                                {product.variants!.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {(product.promotion_ids?.length ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-text-muted">
                                {product.promotion_ids!.length} promo
                                {product.promotion_ids!.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {(product.tags?.length ?? 0) > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-text-muted">
                                {product.tags!.join(", ")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {product.gender ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                          {PRODUCT_GENDER_LABELS[product.gender as ProductGender]}
                        </span>
                      ) : (
                        // Deliberately visible rather than blank. A dash would
                        // read as "not applicable"; this reads as "an admin has
                        // not decided yet", which is what it is, and it is
                        // filterable through the "Not assigned" option.
                        <span className="text-xs text-text-muted italic">
                          Not assigned
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-sm text-on-surface">
                      <div>{product.category || "—"}</div>
                      {product.sub_category && (
                        <div className="text-xs text-text-muted">
                          {product.sub_category}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-sm text-on-surface text-right whitespace-nowrap">
                      <div>৳ {Number(product.price || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                      {/* A discount that is entered but not visible is a
                          discount an admin cannot check, so it is shown as the
                          struck-through original next to the real price. */}
                      {Number(product.original_price || 0) > Number(product.price || 0) && (
                        <div className="text-xs text-text-muted line-through">
                          ৳ {Number(product.original_price).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block min-w-7 px-1.5 h-6 text-xs rounded-full flex items-center justify-center font-semibold ${
                          (product.stock || 0) > LOW_STOCK
                            ? "bg-green-100 text-green-700"
                            : (product.stock || 0) > 0
                            ? "bg-orange-100 text-orange-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {product.stock || 0}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          STATUS_STYLES[product.status ?? "draft"]
                        }`}
                      >
                        {product.status ?? "draft"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-sm text-text-muted whitespace-nowrap">
                      {product.updated_at
                        ? new Date(product.updated_at).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEditModal(product)}
                          className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                          aria-label={`Edit ${product.title}`}
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(product.id)}
                          className="p-1.5 text-text-muted hover:text-badge-discount rounded transition-colors"
                          aria-label={`Remove ${product.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-light">
            <p className="text-xs text-text-muted">
              Page {page} of {pages}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-3 h-8 text-sm font-semibold border border-border-light rounded-lg text-text-muted hover:bg-surface-subtle disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages || loading}
                className="inline-flex items-center gap-1 px-3 h-8 text-sm font-semibold border border-border-light rounded-lg text-text-muted hover:bg-surface-subtle disabled:opacity-40 transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Product Form Modal */}
      {showModal && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          categoriesLoading={categoriesLoading}
          colors={colors}
          colorsLoading={colorsLoading}
          sizes={sizes}
          sizesLoading={sizesLoading}
          promotions={promotions}
          promotionsLoading={promotionsLoading}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            fetchProducts();
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <DeleteConfirmationModal
          productName={
            products.find((p) => p.id === deleteConfirmId)?.title || "this product"
          }
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => deleteProduct(deleteConfirmId)}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function DeleteConfirmationModal({
  productName,
  onCancel,
  onConfirm,
  submitting,
}: {
  productName: string;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-heading"
        className="bg-surface-card rounded-xl shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-badge-discount/10 rounded-full flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-badge-discount" />
          </div>
          <h3
            id="confirm-delete-heading"
            className="font-display text-lg font-bold text-primary"
          >
            Remove Product
          </h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          Remove {productName} from the storefront?
        </p>
        {/* The wording is deliberately not "this cannot be undone". DELETE is a
            soft delete: the row, its variants, its media and its promotion
            links are all kept, and the product can be restored to draft. */}
        <p className="text-xs text-text-muted mb-6">
          The product is retired rather than erased. Its images, variants and
          past orders stay intact, and an administrator can restore it.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-badge-discount text-white rounded-lg font-semibold text-sm hover:bg-badge-discount/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
