"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Edit, Trash2, X, Percent, Tag, Calendar, Search, Check } from "lucide-react";
import type {
  Product,
  PromotionWithProducts,
  PromotionDiscountType,
  PromotionStatus,
} from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

interface ProductOption {
  id: string;
  title: string;
  regular_price?: number | null;
  price?: number | null;
}

const STATUS_STYLES: Record<PromotionStatus, string> = {
  active: "bg-primary/10 text-primary",
  draft: "bg-surface-subtle text-text-muted",
  cancelled: "bg-badge-discount/10 text-badge-discount",
};

const STATUS_LABELS: Record<PromotionStatus, string> = {
  active: "Active",
  draft: "Draft",
  cancelled: "Cancelled",
};

/** datetime-local needs "YYYY-MM-DDTHH:mm" in the browser's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminPromotions() {
  const [promotions, setPromotions] = useState<PromotionWithProducts[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PromotionStatus>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PromotionWithProducts | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (statusFilter) params.set("status", statusFilter);

      const [promoRes, productRes] = await Promise.all([
        fetch(`/api/admin/promotions?${params.toString()}`),
        fetch("/api/admin/products?limit=200"),
      ]);

      const promoJson: ApiResponse<PromotionWithProducts> = await promoRes.json();
      if (!promoRes.ok) throw new Error(promoJson.error ?? "Failed to load promotions");
      setPromotions(promoJson.data ?? []);

      if (productRes.ok) {
        const productJson: ApiResponse<Product> = await productRes.json();
        setProducts(
          (productJson.data ?? []).map((p) => ({
            id: p.id,
            title: p.title,
            regular_price: p.regular_price,
            price: p.price,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const visible = searchQuery
    ? promotions.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : promotions;

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/promotions?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to delete promotion");
      setPromotions((prev) => prev.filter((p) => p.id !== id));
      setDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete promotion");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-primary">Promotions</h2>
          <p className="text-xs text-text-muted mt-1">
            A promotion replaces a product&apos;s standing markdown while it is live. Discounts do not stack.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Promotion
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search promotions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-border-light rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | PromotionStatus)}
          className="h-9 px-3 text-sm border border-border-light rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-primary/20"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-card border border-border-light rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="mt-3 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Tag className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No promotions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((promo) => (
            <div
              key={promo.id}
              className="bg-surface-card border border-border-light rounded-xl p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-base font-bold text-primary">{promo.name}</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        STATUS_STYLES[promo.status]
                      }`}
                    >
                      {STATUS_LABELS[promo.status]}
                    </span>
                    {promo.status === "active" && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          promo.is_live
                            ? "bg-green-100 text-green-700"
                            : "bg-surface-subtle text-text-muted"
                        }`}
                      >
                        {promo.is_live ? "Live now" : "Outside window"}
                      </span>
                    )}
                  </div>
                  {promo.description && (
                    <p className="text-xs text-text-muted mt-1">{promo.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(promo);
                      setModalOpen(true);
                    }}
                    className="p-1.5 text-text-muted hover:text-primary"
                    aria-label="Edit promotion"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(promo.id)}
                    className="p-1.5 text-text-muted hover:text-badge-discount"
                    aria-label="Delete promotion"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-on-surface">
                  {promo.discount_type === "percentage" ? (
                    <Percent className="w-3.5 h-3.5 text-primary" />
                  ) : (
                    <Tag className="w-3.5 h-3.5 text-primary" />
                  )}
                  {promo.discount_type === "percentage"
                    ? `${promo.discount_value}% off`
                    : `${promo.discount_value} off`}
                </span>
                <span className="inline-flex items-center gap-1.5 text-text-muted">
                  <Calendar className="w-3.5 h-3.5" />
                  {new Date(promo.starts_at).toLocaleDateString()} →{" "}
                  {new Date(promo.ends_at).toLocaleDateString()}
                </span>
                <span className="text-text-muted">
                  {promo.product_count} product{promo.product_count === 1 ? "" : "s"}
                </span>
                {promo.badge_label && (
                  <span className="px-2 py-0.5 rounded bg-accent-gold/20 text-on-surface">
                    badge: {promo.badge_label}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <PromotionModal
          promotion={editing}
          products={products}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSuccess={() => {
            setModalOpen(false);
            setEditing(null);
            fetchAll();
          }}
        />
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-badge-discount/10 rounded-full flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-badge-discount" />
              </div>
              <h3 className="font-display text-lg font-bold text-primary">Delete Promotion</h3>
            </div>
            <p className="text-sm text-on-surface-variant mb-6">
              Delete &quot;{promotions.find((p) => p.id === deleteId)?.name}&quot;? Past orders keep
              their own copy of the promotion name, so invoices stay accurate.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove(deleteId)}
                disabled={deleting}
                className="px-4 py-2 bg-badge-discount text-white rounded-lg font-semibold text-sm disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PromotionModal({
  promotion,
  products,
  onClose,
  onSuccess,
}: {
  promotion: PromotionWithProducts | null;
  products: ProductOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = promotion !== null;
  const now = new Date();
  const defaultEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [formData, setFormData] = useState({
    name: promotion?.name ?? "",
    description: promotion?.description ?? "",
    discount_type: (promotion?.discount_type ?? "percentage") as PromotionDiscountType,
    discount_value: promotion?.discount_value ?? 10,
    starts_at: toLocalInput(promotion?.starts_at ?? now.toISOString()),
    ends_at: toLocalInput(promotion?.ends_at ?? defaultEnd.toISOString()),
    status: (promotion?.status ?? "draft") as PromotionStatus,
    badge_label: promotion?.badge_label ?? "",
  });
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    promotion?.product_ids ?? []
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof typeof formData>(key: K, value: (typeof formData)[K]) =>
    setFormData((p) => ({ ...p, [key]: value }));

  const toggleProduct = (id: string) =>
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );

  // Flat discounts are capped by the cheapest selected product; surface that
  // before the server rejects it.
  const cheapestSelected = products
    .filter((p) => selectedProducts.includes(p.id))
    .reduce<number | null>((min, p) => {
      const value = Number(p.regular_price ?? p.price ?? 0);
      return min === null ? value : Math.min(min, value);
    }, null);
  const flatTooLarge =
    formData.discount_type === "flat" &&
    cheapestSelected !== null &&
    Number(formData.discount_value) > cheapestSelected;

  const submit = async () => {
    if (flatTooLarge) {
      setFormError(
        `A flat discount cannot exceed the cheapest selected product (${cheapestSelected}).`
      );
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      // datetime-local is zone-less; convert to an absolute instant so the
      // half-open window is evaluated in UTC, not the server's zone.
      const payload = {
        id: promotion?.id,
        name: formData.name,
        description: formData.description,
        discount_type: formData.discount_type,
        discount_value: Number(formData.discount_value),
        starts_at: new Date(formData.starts_at).toISOString(),
        ends_at: new Date(formData.ends_at).toISOString(),
        status: formData.status,
        badge_label: formData.badge_label,
        product_ids: selectedProducts,
      };

      const res = await fetch("/api/admin/promotions", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save promotion");
      onSuccess();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save promotion");
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-border-light flex items-center justify-between shrink-0">
          <h2 className="font-display text-lg font-bold text-primary">
            {isEdit ? "Edit Promotion" : "New Promotion"}
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 text-text-muted hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {formError && (
            <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-2.5">
              <p className="text-badge-discount text-xs">{formError}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => set("name", e.target.value)}
              className={inputCls}
              placeholder="Eid Sale 2026"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => set("description", e.target.value)}
              className={inputCls}
              placeholder="20% off selected tees"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">Type</label>
              <select
                value={formData.discount_type}
                onChange={(e) => set("discount_type", e.target.value as PromotionDiscountType)}
                className={inputCls}
              >
                <option value="percentage">Percentage</option>
                <option value="flat">Flat amount</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Value {formData.discount_type === "percentage" ? "(%)" : "(amount)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={formData.discount_type === "percentage" ? 100 : undefined}
                value={formData.discount_value}
                onChange={(e) => set("discount_value", Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">Status</label>
              <select
                value={formData.status}
                onChange={(e) => set("status", e.target.value as PromotionStatus)}
                className={inputCls}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {flatTooLarge && (
            <p className="text-xs text-badge-discount">
              Flat discount cannot exceed the cheapest selected product ({cheapestSelected}).
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">Starts *</label>
              <input
                type="datetime-local"
                value={formData.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Ends * <span className="font-normal text-text-muted">(exclusive)</span>
              </label>
              <input
                type="datetime-local"
                value={formData.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Badge label <span className="font-normal text-text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={formData.badge_label}
              onChange={(e) => set("badge_label", e.target.value)}
              className={inputCls}
              placeholder="EID 20%"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-on-surface">
                Products ({selectedProducts.length})
              </label>
              <button
                type="button"
                onClick={() =>
                  setSelectedProducts(
                    selectedProducts.length === products.length ? [] : products.map((p) => p.id)
                  )
                }
                className="text-xs text-primary hover:text-primary-container font-medium"
              >
                {selectedProducts.length === products.length ? "Clear all" : "Select all"}
              </button>
            </div>
            {products.length === 0 ? (
              <p className="text-xs text-text-muted">No products available.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-border-light rounded-lg divide-y divide-border-light">
                {products.map((product) => {
                  const checked = selectedProducts.includes(product.id);
                  return (
                    <label
                      key={product.id}
                      className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-surface-subtle"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(product.id)}
                        className="sr-only"
                      />
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked ? "bg-primary border-primary" : "border-border-light"
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="flex-1 text-on-surface truncate">{product.title}</span>
                      <span className="text-xs text-text-muted font-mono">
                        {Number(product.regular_price ?? product.price ?? 0).toFixed(0)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border-light flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !formData.name || !formData.starts_at || !formData.ends_at}
            className="px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
