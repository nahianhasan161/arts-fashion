"use client";

import { useEffect, useState } from "react";
import { Plus, Edit, Trash2, X } from "lucide-react";
import type { Category } from "@/types";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const fetchCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/categories?limit=100");
      const data: ApiResponse<Category> = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load categories");
      }

      setCategories(data.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load categories"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openCreateModal = () => {
    setEditingCategory(null);
    setShowModal(true);
  };

  const openEditModal = (category: Category) => {
    setEditingCategory(category);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingCategory(null);
  };

  const deleteCategory = async (id: string) => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/categories?id=${id}`, {
        method: "DELETE",
      });
      const data: { error?: string } = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to delete category");
      }

      setCategories((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete category"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-primary">
          Categories
        </h2>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Category
        </button>
      </div>

      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      <div className="bg-surface-card border border-border-light rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Name
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Slug
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-waster px-4 py-3">
                  Count
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center py-8">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="text-center py-12 text-text-muted text-sm"
                  >
                    No categories found.
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr
                    key={category.id}
                    className="border-b border-border-light last:border-b-0"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-on-surface">
                      {category.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {category.slug}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-on-surface">
                      {category.count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => openEditModal(category)}
                          className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                          aria-label="Edit category"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(category.id)}
                          className="p-1.5 text-text-muted hover:text-badge-discount rounded transition-colors"
                          aria-label="Delete category"
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

      {/* Category Form Modal */}
      {showModal && (
        <CategoryFormModal
          category={editingCategory}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            fetchCategories();
          }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirmId && (
        <DeleteConfirmationModal
          categoryName={
            categories.find((c) => c.id === deleteConfirmId)?.name ||
            "this category"
          }
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => deleteCategory(deleteConfirmId)}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function CategoryFormModal({
  category,
  onClose,
  onSuccess,
}: {
  category: Category | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    count: category?.count ?? 0,
    group: category?.group ?? "topwear",
  });
  const isEdit = category !== null;

  const handleChange = (
    field: string,
    value: string | number | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        name: formData.name,
        slug: formData.slug,
        count: formData.count,
        group: formData.group,
      };

      const response = await fetch("/api/admin/categories", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { id: category!.id, ...body } : body
        ),
      });

      const data: { error?: string; success?: boolean } = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save category");
      }

      onSuccess();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to save category"
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
            {isEdit ? "Edit Category" : "Add New Category"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
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
              Count
            </label>
            <input
              type="number"
              value={formData.count}
              onChange={(e) => handleChange("count", parseInt(e.target.value) || 0)}
              className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1.5">
              Group
            </label>
            <select
              value={formData.group}
              onChange={(e) => handleChange("group", e.target.value)}
              className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none"
            >
              <option value="topwear">Topwear</option>
              <option value="bottomwear">Bottomwear</option>
              <option value="special">Special</option>
            </select>
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
  categoryName,
  onCancel,
  onConfirm,
  submitting,
}: {
  categoryName: string;
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
            Delete Category
          </h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          Are you sure you want to delete {categoryName}? This action cannot
          be undone.
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
