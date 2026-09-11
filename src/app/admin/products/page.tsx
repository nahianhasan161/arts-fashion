"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  X,
  Image as ImageIcon,
} from "lucide-react";
import type { Product } from "@/types";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

const badgeTypeOptions: { value: string; label: string }[] = [
  { value: "discount", label: "Discount" },
  { value: "new", label: "New" },
  { value: "festive", label: "Festive" },
  { value: "popular", label: "Popular" },
];

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/products?limit=100${
          searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ""
        }`
      );
      const data: ApiResponse<Product> = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load products");
      }

      let filtered = data.data;
      if (searchQuery) {
        filtered = data.data.filter(
          (p) =>
            p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.slug.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      setProducts(filtered);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load products"
      );
    } finally {
      setLoading(false);
    };
  };

  useEffect(() => {
    fetchProducts();
    const timer = setTimeout(fetchProducts, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

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

      setProducts((prev) => prev.filter((p) => p.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete product"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="relative w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-3 text-sm border border-border-light rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Product
        </button>
      </div>

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
                  Category
                </th>
                <th className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Price
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Stock
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Created
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-12 text-text-muted text-sm"
                  >
                    No products found.
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-border-light last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {product.images?.[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                            src={product.images[0]}
                            alt={product.title}
                            className="w-10 h-10 rounded object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-surface-subtle rounded flex items-center justify-center">
                            <ImageIcon className="w-4 h-4 text-text-muted" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-on-surface text-sm">
                            {product.title}
                          </p>
                          <p className="text-xs text-text-muted">
                            {product.slug}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-on-surface">
                      {product.category}
                    </td>
                    <td className="px-4 py-3 text-sm text-on-surface text-right">
                      ৳ {Number(product.price || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block w-6 h-6 text-xs rounded-full flex items-center justify-center ${
                          (product.stock || 0) > 10
                            ? "bg-green-100 text-green-700"
                            : (product.stock || 0) > 0
                            ? "bg-orange-100 text-orange-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {product.stock || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {product.created_at
                        ? new Date(product.created_at).toLocaleDateString("en-US", {
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
                          aria-label="Edit product"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(product.id)}
                          className="p-1.5 text-text-muted hover:text-badge-discount rounded transition-colors"
                          aria-label="Delete product"
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
      </div>

      {/* Product Form Modal */}
      {showModal && (
        <ProductFormModal
          product={editingProduct}
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

function ProductFormModal({
  product,
  onClose,
  onSuccess,
}: {
  product: Product | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const isEdit = product !== null;

  const [formData, setFormData] = useState({
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    category: product?.category ?? "",
    sub_category: product?.sub_category ?? "",
    description: product?.description ?? "",
    price: product?.price ?? 0,
    original_price: product?.original_price ?? 0,
    discount_percent: product?.discount_percent ?? 0,
    images: product?.images?.join("\n") ?? "",
    colors: product?.colors ? JSON.stringify(product.colors, null, 2) : "",
    sizes: product?.sizes ? JSON.stringify(product.sizes, null, 2) : "",
    stock: product?.stock ?? 0,
    badge: product?.badge ?? "",
    badge_type: product?.badge_type ?? "",
    is_featured: product?.is_featured ?? false,
    specs: product?.specs ? JSON.stringify(product.specs, null, 2) : "",
  });

  const handleChange = (
    field: string,
    value: string | number | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        slug: formData.slug,
        title: formData.title,
        category: formData.category,
        sub_category: formData.sub_category || null,
        description: formData.description,
        price: formData.price,
        original_price: formData.original_price,
        discount_percent: formData.discount_percent,
        images: formData.images
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        colors: formData.colors ? JSON.parse(formData.colors) : [],
        sizes: formData.sizes ? JSON.parse(formData.sizes) : [],
        stock: formData.stock,
        badge: formData.badge || null,
        badge_type: formData.badge_type || null,
        is_featured: formData.is_featured,
        specs: formData.specs ? JSON.parse(formData.specs) : {},
      };

      let response: Response;
      if (isEdit) {
        response = await fetch("/api/admin/products", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: product!.id, ...body }),
        });
      } else {
        response = await fetch("/api/admin/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      const data: { error?: string; success?: boolean } = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save product");
      }

      onSuccess();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to save product"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border-light flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-primary">
            {isEdit ? "Edit Product" : "Add New Product"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => handleChange("title", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Slug *
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => handleChange("slug", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Category *
              </label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => handleChange("category", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Sub-category
              </label>
              <input
                type="text"
                value={formData.sub_category}
                onChange={(e) => handleChange("sub_category", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Price *
              </label>
              <input
                type="number"
                value={formData.price}
                onChange={(e) => handleChange("price", parseFloat(e.target.value) || 0)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Original Price *
              </label>
              <input
                type="number"
                value={formData.original_price}
                onChange={(e) =>
                  handleChange(
                    "original_price",
                    parseFloat(e.target.value) || 0
                  )
                }
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Discount %
              </label>
              <input
                type="number"
                value={formData.discount_percent}
                onChange={(e) =>
                  handleChange(
                    "discount_percent",
                    parseInt(e.target.value) || 0
                  )
                }
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Stock
              </label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) => handleChange("stock", parseInt(e.target.value) || 0)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Badge
              </label>
              <input
                type="text"
                value={formData.badge}
                onChange={(e) => handleChange("badge", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Badge Type
              </label>
              <select
                value={formData.badge_type}
                onChange={(e) => handleChange("badge_type", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none"
              >
                <option value="">None</option>
                {badgeTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Description
            </label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(e) => handleChange("description", e.target.value)}
              className="w-full px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Images (one URL per line)
            </label>
            <textarea
              rows={3}
              value={formData.images}
              onChange={(e) => handleChange("images", e.target.value)}
              placeholder="https://example.com/image1.jpg"
              className="w-full px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Colors (JSON array)
              </label>
              <textarea
                rows={4}
                value={formData.colors}
                onChange={(e) => handleChange("colors", e.target.value)}
                placeholder='[{"name":"Red","hex":"#ff0000"}]'
                className="w-full px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Sizes (JSON array)
              </label>
              <textarea
                rows={4}
                value={formData.sizes}
                onChange={(e) => handleChange("sizes", e.target.value)}
                placeholder='[{"size":"M","chest":"40","stock":10}]'
                className="w-full px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Specs (JSON object)
            </label>
            <textarea
              rows={3}
              value={formData.specs}
              onChange={(e) => handleChange("specs", e.target.value)}
              placeholder='{"Fabric":"100% Cotton","Weight":"175 GSM"}'
              className="w-full px-3 py-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_featured"
              checked={formData.is_featured}
              onChange={(e) => handleChange("is_featured", e.target.checked)}
            />
            <label htmlFor="is_featured" className="text-sm text-on-surface">
              Featured product
            </label>
          </div>
        </div>

        <div className="p-6 border-t border-border-light flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
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
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-badge-discount/10 rounded-full flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-badge-discount" />
          </div>
          <h3 className="font-display text-lg font-bold text-primary">
            Delete Product
          </h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          Are you sure you want to delete {productName}? This action cannot be
          undone.
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
            {submitting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
