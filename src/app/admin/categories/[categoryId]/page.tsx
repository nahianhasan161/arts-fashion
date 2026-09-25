"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Plus, Edit, Trash2, X, ChevronLeft } from "lucide-react";
import { slugify } from "@/lib/utils";
import type { Category } from "@/types";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminSubcategories() {
  const router = useRouter();
  const params = useParams<{ categoryId: string }>();
  const parentId = params.categoryId;

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [parentCategory, setParentCategory] = useState<Category | null>(null);

  const fetchParentCategory = useCallback(async () => {
    if (!parentId) return;
    try {
      const response = await fetch(`/api/admin/categories?id=${parentId}`);
      if (!response.ok) {
        const data: { error?: string } = await response.json();
        throw new Error(data.error ?? "Failed to load parent category");
      }
      const data: ApiResponse<Category> = await response.json();
      setParentCategory(data.data[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load parent category");
    }
  }, [parentId]);

  const fetchSubcategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/categories?parent_id=${parentId}&limit=100`);
      const data: ApiResponse<Category> = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load subcategories");
      }

      setCategories(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load subcategories");
    } finally {
      setLoading(false);
    }
  }, [parentId]);

  useEffect(() => {
    if (parentId) {
      fetchParentCategory();
      fetchSubcategories();
    }
  }, [parentId, fetchParentCategory, fetchSubcategories]);

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
        throw new Error(data.error ?? "Failed to delete subcategory");
      }

      setCategories((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete subcategory");
    } finally {
      setSubmitting(false);
    }
  };

  if (!parentId) {
    return (
      <div className="space-y-6">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/admin/categories")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-text-muted hover:text-primary rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Categories
          </button>
          <h2 className="font-display text-xl font-bold text-primary">
            {parentCategory?.name || "Subcategories"}
          </h2>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Subcategory
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
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Sub-subcategories
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
                    No subcategories found.
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <SubcategoryRow
                    key={category.id}
                    category={category}
                    onEdit={openEditModal}
                    onDelete={setDeleteConfirmId}
                    onNavigate={(id) => router.push(`/admin/categories/${id}`)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <SubcategoryFormModal
          category={editingCategory}
          parentId={parentId}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            fetchSubcategories();
          }}
        />
      )}

      {deleteConfirmId && (
        <DeleteConfirmationModal
          categoryName={
            categories.find((c) => c.id === deleteConfirmId)?.name || "this subcategory"
          }
          onCancel={() => setDeleteConfirmId(null)}
          onConfirm={() => deleteCategory(deleteConfirmId)}
          submitting={submitting}
        />
      )}
    </div>
  );
}

function SubcategoryRow({
  category,
  onEdit,
  onDelete,
  onNavigate,
}: {
  category: Category;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  return (
    <tr
      className="border-b border-border-light last:border-b-0 hover:bg-surface-subtle/50 transition-colors cursor-pointer"
      onClick={() => onNavigate(category.id)}
    >
      <td className="px-4 py-3 text-sm font-medium text-on-surface">
        {category.name}
      </td>
      <td className="px-4 py-3 text-sm text-text-muted">{category.slug}</td>
      <td className="px-4 py-3 text-center text-sm text-text-muted">
        {category.children && category.children.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            {category.children.length} sub-subcategories
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(category);
            }}
            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
            aria-label="Edit subcategory"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(category.id);
            }}
            className="p-1.5 text-text-muted hover:text-badge-discount rounded transition-colors"
            aria-label="Delete subcategory"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function SubcategoryFormModal({
  category,
  parentId,
  onClose,
  onSuccess,
}: {
  category: Category | null;
  parentId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: category?.name ?? "",
    slug: category?.slug ?? "",
  });
  const isEdit = category !== null;
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const handleChange = (
    field: string,
    value: string | number | boolean
  ) => {
    setFormData((prev) => {
      if (field === "name" && !slugManuallyEdited) {
        return { name: value as string, slug: slugify(value as string) };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const body = {
        name: formData.name,
        slug: formData.slug,
        parent_id: parentId,
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
        throw new Error(data.error ?? "Failed to save subcategory");
      }

      onSuccess();
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to save subcategory"
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
            {isEdit ? "Edit Subcategory" : "Add Subcategory"}
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
              onChange={(e) => {
                handleChange("slug", e.target.value);
                setSlugManuallyEdited(true);
              }}
              className="w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 font-mono"
            />
          </div>
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
            Delete Subcategory
          </h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">
          Are you sure you want to delete {categoryName}? This action cannot
          be undone.
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