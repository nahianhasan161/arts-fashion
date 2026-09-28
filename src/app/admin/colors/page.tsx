"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Edit, Trash2, X, Palette, Search, Sparkles } from "lucide-react";
import type { ColorPalette, Category } from "@/types";
import { flattenCategoryTree } from "@/lib/utils";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminColors() {
  const [colors, setColors] = useState<ColorPalette[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingColor, setEditingColor] = useState<ColorPalette | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchColors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/colors?limit=100`);
      const data: ApiResponse<ColorPalette> = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load colors");
      }

      // Filter by search query
      let filtered = data.data;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = data.data.filter(
          (c) => c.name.toLowerCase().includes(q) || c.hex.toLowerCase().includes(q)
        );
      }

      setColors(filtered);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load colors"
      );
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/categories?limit=100");
      const data: ApiResponse<Category> = await response.json();
      if (response.ok) {
        // Flatten categories for selecting in filter. The endpoint returns a
        // tree; this shared helper is the single definition of that flatten.
        setCategories(flattenCategoryTree(data.data ?? []));
      }
    } catch {
      // Ignore category fetch errors
    }
  }, []);

  useEffect(() => {
    fetchColors();
    fetchCategories();
  }, [fetchColors, fetchCategories]);

  const openCreateModal = () => {
    setEditingColor(null);
    setShowModal(true);
  };

  const openEditModal = (color: ColorPalette) => {
    setEditingColor(color);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingColor(null);
  };

  const deleteColor = async (id: string) => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/colors?id=${id}`, {
        method: "DELETE",
      });
      const data: { error?: string } = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete color");
      }

      setColors((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete color"
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Group colors: Global colors first, then by category
  const globalColors = colors.filter((c) => c.is_global);
  const categoryColors = colors.filter((c) => !c.is_global);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-primary">
          Color Palette
        </h2>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Color
        </button>
      </div>

      {/* Search */}
      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search colors by name or hex..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-9 pr-3 text-sm border border-border-light rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      {/* Global Colors Section */}
      {globalColors.length > 0 && (
        <>
          <h3 className="font-display text-sm font-semibold text-text-muted uppercase tracking-wider">
            Global Colors
          </h3>
          <ColorGrid
            colors={globalColors}
            onEdit={openEditModal}
            onDelete={setDeleteConfirmId}
          />
        </>
      )}

      {/* Category Colors Section */}
      {categoryColors.length > 0 && (
        <>
          <h3 className="font-display text-sm font-semibold text-text-muted uppercase tracking-wider">
            Category Colors
          </h3>
          <ColorGrid
            colors={categoryColors}
            categories={categories}
            onEdit={openEditModal}
            onDelete={setDeleteConfirmId}
          />
        </>
      )}

      {/* Empty state */}
      {!loading && colors.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <Palette className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No colors found. Create a color to get started.</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      )}

      {/* Modals */}
      {showModal && (
        <ColorFormModal
          color={editingColor}
          categories={categories}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            fetchColors();
          }}
        />
      )}

      {deleteConfirmId && (
        <DeleteConfirmationModal
          colorName={
            colors.find((c) => c.id === deleteConfirmId)?.name || "this color"
          }
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => deleteColor(deleteConfirmId)}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function ColorGrid({
  colors,
  categories,
  onEdit,
  onDelete,
}: {
  colors: ColorPalette[];
  categories?: Category[];
  onEdit: (color: ColorPalette) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {colors.map((color) => {
        const categoryName = color.category_id && categories
          ? categories.find((c) => c.id === color.category_id)?.name
          : null;
        return (
          <div
            key={color.id}
            className="bg-surface-card border border-border-light rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
            onClick={() => onEdit(color)}
          >
            {/* Color swatch */}
            <div
              className="w-full h-16 rounded-lg mb-2 border border-border-light"
              style={{ backgroundColor: color.hex }}
            />
            {/* Color info */}
            <div className="space-y-1">
              <p className="text-sm font-medium text-on-surface">{color.name}</p>
              <p className="text-xs text-text-muted font-mono">{color.hex}</p>
              {(categoryName || color.is_global) && (
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  {color.is_global ? (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-primary" />
                      <span>Global</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Palette className="w-3 h-3" />
                      <span>{categoryName}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
            {/* Actions */}
            <div className="mt-2 flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(color);
                }}
                className="p-1 text-text-muted hover:text-primary rounded transition-colors"
                aria-label="Edit color"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(color.id);
                }}
                className="p-1 text-text-muted hover:text-badge-discount rounded transition-colors"
                aria-label="Delete color"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColorFormModal({
  color,
  categories,
  onClose,
  onSuccess,
}: {
  color: ColorPalette | null;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: color?.name ?? "",
    hex: color?.hex ?? "#000000",
    category_id: color?.category_id ?? "",
    is_global: color?.is_global ?? false,
  });
  const isEdit = color !== null;

  const handleChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        name: formData.name,
        hex: formData.hex,
        category_id: formData.is_global ? null : (formData.category_id || null),
        is_global: formData.is_global,
      };

      const response = await fetch("/api/admin/colors", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { id: color!.id, ...body } : body
        ),
      });

      const data: { error?: string; success?: boolean } = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save color");
      }

      onSuccess();
    } catch (err) {
      alert(
        err instanceof Error ? err.message : "Failed to save color"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-border-light flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-primary">
            {isEdit ? "Edit Color" : "Add New Color"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Color swatch preview */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg border border-border-light"
              style={{ backgroundColor: formData.hex }}
            />
            <span className="text-xs text-text-muted font-mono">{formData.hex}</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
              placeholder="e.g., Charcoal Black"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Hex Color *
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={formData.hex}
                onChange={(e) => handleChange("hex", e.target.value)}
                className="w-10 h-9 p-0 border border-border-light rounded-lg cursor-pointer"
              />
              <input
                type="text"
                value={formData.hex}
                onChange={(e) => handleChange("hex", e.target.value)}
                className="flex-1 h-9 px-3 border border-border-light rounded-lg text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/20"
                placeholder="#000000"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_global"
              checked={formData.is_global}
              onChange={(e) => handleChange("is_global", e.target.checked)}
            />
            <label htmlFor="is_global" className="text-sm text-on-surface">
              Apply to all categories (global color)
            </label>
          </div>

          {!formData.is_global && (
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1.5">
                Category
              </label>
              <select
                value={formData.category_id}
                onChange={(e) => handleChange("category_id", e.target.value)}
                className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none bg-white"
              >
                <option value="">Select a category (optional)</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-border-light flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
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
  colorName,
  onCancel,
  onConfirm,
  submitting,
}: {
  colorName: string;
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
            Delete Color
          </h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          Are you sure you want to delete {colorName}? This action cannot be
          undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
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