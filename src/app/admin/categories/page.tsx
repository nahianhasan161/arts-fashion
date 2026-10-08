"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Edit, Trash2, X, ChevronDown, ChevronRight } from "lucide-react";
import { slugify } from "@/lib/utils";
import type { Category } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

interface ApiResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminCategories() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchCategories = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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

      setCategories((prev) => removeNode(prev, id));
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

  const removeNode = (categories: Category[], id: string): Category[] => {
    return categories
      .filter((c) => c.id !== id)
      .map((c) => ({
        ...c,
        children: c.children ? removeNode(c.children, id) : [],
      }));
  };

  const hasChildren = (category: Category): boolean =>
    Boolean(category.children && category.children.length > 0);

  // Navigate to subcategory management page for a category
  const navigateToSubcategories = (category: Category) => {
    router.push(`/admin/categories/${category.id}`);
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
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Subcategories
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-light last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Skeleton className="w-4 h-4" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-40" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Skeleton className="h-4 w-8 mx-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Skeleton className="h-7 w-7 rounded" />
                        <Skeleton className="h-7 w-7 rounded" />
                      </div>
                    </td>
                  </tr>
                ))
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
                  <CategoryRow
                    key={category.id}
                    category={category}
                    level={0}
                    expandedIds={expandedIds}
                    onToggle={toggleExpand}
                    onEdit={openEditModal}
                    onDelete={setDeleteConfirmId}
                    hasChildren={hasChildren}
                    onNavigate={navigateToSubcategories}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <CategoryFormModal
          category={editingCategory}
          parentId={editingCategory?.parent_id ?? null}
          onClose={closeModal}
          onSuccess={() => {
            closeModal();
            fetchCategories();
          }}
        />
      )}

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

function CategoryRow({
  category,
  level,
  expandedIds,
  onToggle,
  onEdit,
  onDelete,
  hasChildren,
  onNavigate,
}: {
  category: Category;
  level: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (category: Category) => void;
  onDelete: (id: string) => void;
  hasChildren: (category: Category) => boolean;
  onNavigate: (category: Category) => void;
}) {
  const isExpanded = expandedIds.has(category.id);
  const children = category.children ?? [];
  const childCount = children.length;
  const hasChild = hasChildren(category);

  return (
    <>
      <tr className="border-b border-border-light last:border-b-0 hover:bg-surface-subtle/50 transition-colors">
        <td className="px-4 py-3 text-sm font-medium text-on-surface">
          <span
            className="inline-flex items-center gap-1"
            style={{ paddingLeft: `${level * 20}px` }}
          >
            {hasChild ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggle(category.id);
                }}
                className="p-0.5 text-text-muted hover:text-primary transition-colors"
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5 inline-block" />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavigate(category);
              }}
              className="text-primary hover:underline transition-colors"
            >
              {category.name}
            </button>
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-text-muted">{category.slug}</td>
        <td className="px-4 py-3 text-center text-sm text-text-muted">
          {childCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              {childCount} sub
              {childCount === 1 ? "" : "categories"}
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
              aria-label="Edit category"
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
              aria-label="Delete category"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded &&
        children.map((child) => (
          <CategoryRow
            key={child.id}
            category={child}
            level={level + 1}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            hasChildren={hasChildren}
            onNavigate={onNavigate}
          />
        ))}
    </>
  );
}

function CategoryFormModal({
  category,
  parentId,
  onClose,
  onSuccess,
}: {
  category: Category | null;
  parentId: string | null;
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
        ...(parentId && { parent_id: parentId }),
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
            {isEdit ? "Edit Category" : parentId ? "Add Subcategory" : "Add New Category"}
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
          {parentId && (
            <p className="text-xs text-text-muted">
              This subcategory will be nested under its parent category.
            </p>
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