"use client";

import { useEffect, useState } from "react";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { ProductFormModal } from "@/components/admin/products/ProductFormModal";
import type { Category, ColorOption, Product, Promotion, SizeLabel } from "@/types";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
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

  const fetchCategories = async () => {
    setCategoriesLoading(true);
    try {
      const response = await fetch("/api/admin/categories?limit=100");
      const data: ApiResponse<Category> = await response.json();
      if (response.ok) {
        setCategories(data.data);
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
      const response = await fetch("/api/admin/colors?limit=200");
      const data: ApiResponse<ColorOption> = await response.json();
      if (response.ok) {
        setColors(data.data);
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
      const response = await fetch("/api/admin/sizes?limit=200");
      const data: ApiResponse<SizeLabel> = await response.json();
      if (response.ok) {
        setSizes(data.data);
      }
    } catch {
      // Ignore size fetch errors
    } finally {
      setSizesLoading(false);
    }
  };

  // Only the options an admin can act on: a withdrawn size or colour should
  // not be offered, though both still show in the matrix of a product that
  // already uses them.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // The option lists are reference data, not a function of the search, so they
  // are loaded once rather than on every keystroke.
  useEffect(() => {
    fetchCategories();
    fetchColors();
    fetchSizes();
    fetchPromotions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                      <div>
                        <span>{product.category}</span>
                        {product.sub_category && (
                          <span className="text-text-muted">
                            {" > "}
                            {product.sub_category}
                          </span>
                        )}
                      </div>
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
