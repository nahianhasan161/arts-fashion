"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Edit, Trash2, X, Ruler, Globe, Search } from "lucide-react";
import {
  MEASUREMENT_KEYS,
  type Category,
  type SizeLabelWithMeasurements,
  type SizeMeasurement,
  type SizeRegion,
  type SizeRegionCode,
} from "@/types";

interface MeasurementRow {
  key: string;
  value: string;
}

export default function AdminSizes() {
  const [sizes, setSizes] = useState<SizeLabelWithMeasurements[]>([]);
  const [regions, setRegions] = useState<SizeRegion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [labelModalOpen, setLabelModalOpen] = useState(false);
  const [editingSize, setEditingSize] = useState<SizeLabelWithMeasurements | null>(null);
  const [measurementTarget, setMeasurementTarget] = useState<SizeLabelWithMeasurements | null>(null);
  const [editingMeasurement, setEditingMeasurement] = useState<SizeMeasurement | null>(null);
  const [deleteSizeId, setDeleteSizeId] = useState<string | null>(null);
  const [deleteMeasurement, setDeleteMeasurement] = useState<{
    sizeId: string;
    measurement: SizeMeasurement;
  } | null>(null);

  const regionMeta = (code: string) => regions.find((r) => r.code === code);

  const categoryName = (id: string | null) => {
    if (!id) return "All categories";
    const found = categories.find((c) => c.id === id);
    return found?.name ?? "Unknown category";
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sizesRes, regionsRes, catRes] = await Promise.all([
        fetch("/api/admin/sizes?include_measurements=true&limit=200"),
        fetch("/api/admin/size-regions"),
        fetch("/api/admin/categories?limit=200"),
      ]);

      const sizesJson = await sizesRes.json();
      if (!sizesRes.ok) throw new Error(sizesJson.error ?? "Failed to load sizes");
      setSizes(sizesJson.data ?? []);

      if (regionsRes.ok) {
        const regionsJson = await regionsRes.json();
        setRegions(regionsJson.data ?? []);
      }

      if (catRes.ok) {
        const catJson = await catRes.json();
        const flatten = (nodes: Category[]): Category[] =>
          nodes.flatMap((n) => [n, ...(n.children ? flatten(n.children) : [])]);
        setCategories(flatten(catJson.data ?? []));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sizes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const visible = searchQuery
    ? sizes.filter((s) => s.display_name.toLowerCase().includes(searchQuery.toLowerCase()))
    : sizes;

  const openCreateLabel = () => {
    setEditingSize(null);
    setLabelModalOpen(true);
  };

  const openEditLabel = (size: SizeLabelWithMeasurements) => {
    setEditingSize(size);
    setLabelModalOpen(true);
  };

  const openCreateMeasurement = (size: SizeLabelWithMeasurements) => {
    setEditingMeasurement(null);
    setMeasurementTarget(size);
  };

  const openEditMeasurement = (
    size: SizeLabelWithMeasurements,
    measurement: SizeMeasurement
  ) => {
    setEditingMeasurement(measurement);
    setMeasurementTarget(size);
  };

  const closeLabelModal = () => {
    setLabelModalOpen(false);
    setEditingSize(null);
  };

  const closeMeasurementModal = () => {
    setMeasurementTarget(null);
    setEditingMeasurement(null);
  };

  const deleteSize = async (id: string) => {
    const res = await fetch(`/api/admin/sizes?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setSizes((prev) => prev.filter((s) => s.id !== id));
      setDeleteSizeId(null);
    } else {
      const json = await res.json();
      setError(json.error ?? "Failed to delete size");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-primary">Size Management</h2>
          <p className="text-xs text-text-muted mt-1">
            Size labels are canonical. Each region renders the same size in its own scale.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateLabel}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Size
        </button>
      </div>

      <div className="relative w-80">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search sizes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-9 pl-9 pr-3 text-sm border border-border-light rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
        />
      </div>

      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Ruler className="w-8 h-8 mx-auto mb-3 opacity-50" />
          <p>No sizes yet. Add a size label to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((size) => {
            const generic = size.measurements.filter((m) => !m.category_id);
            const scoped = size.measurements.filter((m) => m.category_id);
            return (
              <div
                key={size.id}
                className="bg-surface-card border border-border-light rounded-xl shadow-sm"
              >
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-lg bg-primary text-white flex items-center justify-center font-display text-lg font-bold shrink-0">
                      {size.display_name}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-on-surface">
                        {size.name}
                        <span className="ml-2 text-xs font-normal text-text-muted">
                          {size.type} / {size.fit_type}
                        </span>
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        sort {size.sort_key}
                        {size.is_active ? "" : "  •  inactive"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditLabel(size)}
                      className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                      aria-label="Edit size"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteSizeId(size.id)}
                      className="p-1.5 text-text-muted hover:text-badge-discount rounded transition-colors"
                      aria-label="Delete size"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Regional charts */}
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Regional charts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {regions.map((region) => {
                      const row = generic.find((m) => m.region_code === region.code);
                      return (
                        <button
                          key={region.code}
                          type="button"
                          onClick={() =>
                            row
                              ? openEditMeasurement(size, row)
                              : openCreateMeasurement(size)
                          }
                          className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                            row
                              ? "border-border-light bg-surface-subtle hover:border-primary"
                              : "border-dashed border-border-light text-text-muted hover:border-primary"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-on-surface">
                            <Globe className="w-3 h-3" />
                            {region.name}
                            <span className="font-normal text-text-muted">
                              ({region.unit})
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-text-muted">
                            {row
                              ? Object.entries(row.measurements)
                                  .map(([k, v]) => `${k} ${v}`)
                                  .join("  •  ") || "no measurements"
                              : "not set"}
                          </div>
                          {row?.label_override && (
                            <div className="mt-1 text-text-muted">
                              shown as{" "}
                              <span className="font-bold text-primary">
                                {row.label_override}
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openCreateMeasurement(size)}
                      className="px-3 py-2 rounded-lg border border-dashed border-border-light text-xs text-text-muted hover:border-primary hover:text-primary transition-colors"
                    >
                      <Plus className="w-3 h-3 inline mr-1" />
                      category-specific
                    </button>
                  </div>

                  {scoped.length > 0 && (
                    <div className="pt-1 space-y-1">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                        Category overrides
                      </p>
                      {scoped.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center justify-between gap-2 text-xs bg-surface-subtle rounded-lg px-3 py-1.5"
                        >
                          <span className="text-on-surface">
                            <span className="font-semibold">
                              {regionMeta(m.region_code)?.name ?? m.region_code}
                            </span>
                            <span className="text-text-muted">
                              {" "}
                              • {categoryName(m.category_id)} •{" "}
                              {Object.entries(m.measurements)
                                .map(([k, v]) => `${k} ${v}`)
                                .join(", ")}
                            </span>
                          </span>
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditMeasurement(size, m)}
                              className="p-1 text-text-muted hover:text-primary"
                              aria-label="Edit override"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteMeasurement({ sizeId: size.id, measurement: m })
                              }
                              className="p-1 text-text-muted hover:text-badge-discount"
                              aria-label="Delete override"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {labelModalOpen && (
        <SizeLabelModal
          size={editingSize}
          nextSortKey={sizes.length + 1}
          onClose={closeLabelModal}
          onSuccess={() => {
            closeLabelModal();
            fetchAll();
          }}
        />
      )}

      {measurementTarget && (
        <MeasurementModal
          size={measurementTarget}
          measurement={editingMeasurement}
          regions={regions}
          categories={categories}
          onClose={closeMeasurementModal}
          onSuccess={() => {
            closeMeasurementModal();
            fetchAll();
          }}
        />
      )}

      {deleteSizeId && (
        <ConfirmModal
          title="Delete Size"
          message={`Delete "${sizes.find((s) => s.id === deleteSizeId)?.display_name ?? "this size"}"? Its regional charts are removed too. This cannot be undone.`}
          onCancel={() => setDeleteSizeId(null)}
          onConfirm={() => deleteSize(deleteSizeId)}
        />
      )}

      {deleteMeasurement && (
        <ConfirmModal
          title="Delete Chart Entry"
          message={`Remove the ${regionMeta(deleteMeasurement.measurement.region_code)?.name ?? ""} entry for "${measurementTarget?.display_name ?? "this size"}"?`}
          onCancel={() => setDeleteMeasurement(null)}
          onConfirm={async () => {
            const res = await fetch(
              `/api/admin/sizes/${deleteMeasurement.sizeId}/measurements?id=${deleteMeasurement.measurement.id}`,
              { method: "DELETE" }
            );
            if (res.ok) {
              setDeleteMeasurement(null);
              fetchAll();
            } else {
              const json = await res.json();
              setError(json.error ?? "Failed to delete chart entry");
            }
          }}
        />
      )}
    </div>
  );
}

function SizeLabelModal({
  size,
  nextSortKey,
  onClose,
  onSuccess,
}: {
  size: SizeLabelWithMeasurements | null;
  nextSortKey: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: size?.name ?? "",
    display_name: size?.display_name ?? "",
    type: size?.type ?? "clothing",
    fit_type: size?.fit_type ?? "standard",
    sort_key: size?.sort_key ?? nextSortKey,
    is_active: size?.is_active ?? true,
  });
  const isEdit = size !== null;

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/sizes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { id: size!.id, ...formData } : formData
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save size");
      onSuccess();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save size");
    } finally {
      setSubmitting(false);
    }
  };

  const suggestions = MEASUREMENT_KEYS[formData.type] ?? [];

  return (
    <ModalShell title={isEdit ? "Edit Size" : "Add Size"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Canonical name *">
          <input
            type="text"
            value={formData.name}
            onChange={(e) =>
              setFormData((p) => ({
                ...p,
                name: e.target.value,
                display_name: p.display_name || e.target.value,
              }))
            }
            className={inputCls}
            placeholder="M"
          />
        </Field>

        <Field label="Display label" hint="What shoppers see in letter regions">
          <input
            type="text"
            value={formData.display_name}
            onChange={(e) =>
              setFormData((p) => ({ ...p, display_name: e.target.value }))
            }
            className={inputCls}
            placeholder="M"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select
              value={formData.type}
              onChange={(e) =>
                setFormData((p) => ({ ...p, type: e.target.value }))
              }
              className={inputCls}
            >
              <option value="clothing">clothing</option>
              <option value="footwear">footwear</option>
            </select>
          </Field>
          <Field label="Fit">
            <input
              type="text"
              value={formData.fit_type}
              onChange={(e) =>
                setFormData((p) => ({ ...p, fit_type: e.target.value }))
              }
              className={inputCls}
              placeholder="standard"
            />
          </Field>
        </div>

        <Field label="Sort order" hint="Ascending, smallest first">
          <input
            type="number"
            value={formData.sort_key}
            onChange={(e) =>
              setFormData((p) => ({ ...p, sort_key: Number(e.target.value) }))
            }
            className={inputCls}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) =>
              setFormData((p) => ({ ...p, is_active: e.target.checked }))
            }
          />
          Active
        </label>

        {suggestions.length > 0 && (
          <p className="text-xs text-text-muted">
            Suggested {formData.type} measurements: {suggestions.join(", ")}
          </p>
        )}
      </div>

      <ModalActions
        onClose={onClose}
        onSubmit={submit}
        submitting={submitting}
        submitLabel={isEdit ? "Update" : "Create"}
      />
    </ModalShell>
  );
}

function MeasurementModal({
  size,
  measurement,
  regions,
  categories,
  onClose,
  onSuccess,
}: {
  size: SizeLabelWithMeasurements;
  measurement: SizeMeasurement | null;
  regions: SizeRegion[];
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = measurement !== null;
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [regionCode, setRegionCode] = useState<SizeRegionCode>(
    (measurement?.region_code as SizeRegionCode) ?? "GLOBAL"
  );
  const [categoryId, setCategoryId] = useState(measurement?.category_id ?? "");
  const [labelOverride, setLabelOverride] = useState(measurement?.label_override ?? "");
  const [rows, setRows] = useState<MeasurementRow[]>(() => {
    const entries = Object.entries(measurement?.measurements ?? {});
    if (entries.length > 0) {
      return entries.map(([key, value]) => ({ key, value: String(value) }));
    }
    const suggested = MEASUREMENT_KEYS[size.type] ?? [];
    return suggested.map((key) => ({ key, value: "" }));
  });

  const unit = regions.find((r) => r.code === regionCode)?.unit ?? "cm";

  const submit = async () => {
    const measurements: Record<string, number> = {};
    for (const row of rows) {
      const key = row.key.trim().toLowerCase();
      if (!key) continue;
      const value = Number(row.value);
      if (!Number.isFinite(value)) {
        setFormError(`"${row.key}" needs a numeric value`);
        return;
      }
      measurements[key] = value;
    }
    if (Object.keys(measurements).length === 0) {
      setFormError("Add at least one measurement");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const body = {
        region_code: regionCode,
        category_id: categoryId || null,
        label_override: labelOverride || null,
        measurements,
      };
      const res = await fetch(`/api/admin/sizes/${size.id}/measurements`, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: measurement!.id, ...body } : body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save chart entry");
      onSuccess();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save chart entry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={`${isEdit ? "Edit" : "Add"} chart — ${size.display_name}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        {formError && (
          <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-2.5">
            <p className="text-badge-discount text-xs">{formError}</p>
          </div>
        )}

        <Field label="Region *">
          <select
            value={regionCode}
            onChange={(e) => setRegionCode(e.target.value as SizeRegionCode)}
            className={inputCls}
          >
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name} ({r.unit})
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Category scope"
          hint="Leave as all categories for the region-wide default"
        >
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputCls}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Label override"
          hint={`Leave blank to show "${size.display_name}" in every region`}
        >
          <input
            type="text"
            value={labelOverride}
            onChange={(e) => setLabelOverride(e.target.value)}
            className={inputCls}
            placeholder="40"
          />
        </Field>

        <div>
          <label className="block text-xs font-semibold text-on-surface mb-1.5">
            Measurements ({unit})
          </label>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={row.key}
                  onChange={(e) =>
                    setRows((p) =>
                      p.map((r, i) => (i === index ? { ...r, key: e.target.value } : r))
                    )
                  }
                  className={`${inputCls} flex-1`}
                  placeholder="chest"
                />
                <input
                  type="number"
                  step="0.1"
                  value={row.value}
                  onChange={(e) =>
                    setRows((p) =>
                      p.map((r, i) => (i === index ? { ...r, value: e.target.value } : r))
                    )
                  }
                  className={`${inputCls} w-28`}
                  placeholder="102"
                />
                <button
                  type="button"
                  onClick={() => setRows((p) => p.filter((_, i) => i !== index))}
                  className="p-1.5 text-text-muted hover:text-badge-discount"
                  aria-label="Remove measurement"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setRows((p) => [...p, { key: "", value: "" }])}
            className="mt-2 text-xs text-primary hover:text-primary-container font-medium"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            Add measurement
          </button>
        </div>
      </div>

      <ModalActions
        onClose={onClose}
        onSubmit={submit}
        submitting={submitting}
        submitLabel={isEdit ? "Update" : "Create"}
      />
    </ModalShell>
  );
}

function ConfirmModal({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-badge-discount/10 rounded-full flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-badge-discount" />
          </div>
          <h3 className="font-display text-lg font-bold text-primary">{title}</h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-6">{message}</p>
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
            onClick={async () => {
              setSubmitting(true);
              await onConfirm();
              setSubmitting(false);
            }}
            disabled={submitting}
            className="px-4 py-2 bg-badge-discount text-white rounded-lg font-semibold text-sm hover:bg-badge-discount/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-border-light flex items-center justify-between shrink-0">
          <h2 className="font-display text-lg font-bold text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-primary"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onSubmit,
  submitting,
  submitLabel,
}: {
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="p-6 border-t border-border-light flex items-center justify-end gap-3 shrink-0">
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors disabled:opacity-50"
      >
        {submitting ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-on-surface mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20";
