"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Edit,
  Trash2,
  X,
  Ticket,
  Users,
  Search,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import type {
  CouponAppliesTo,
  CouponDiscountType,
  CouponStatus,
  CouponWithUsage,
  UserGroupWithCount,
} from "@/types";

const STATUS_STYLES: Record<CouponStatus, string> = {
  active: "bg-primary/10 text-primary",
  draft: "bg-surface-subtle text-text-muted",
  cancelled: "bg-badge-discount/10 text-badge-discount",
};

/** Same message text the checkout page uses, so admin and shopper agree. */
const REJECTION_HINTS: Record<string, string> = {
  coupon_inactive: "Draft or cancelled coupons cannot be redeemed.",
  coupon_not_started: "The window has not opened yet.",
  coupon_expired: "The window has closed.",
  coupon_used_up: "Every use has been redeemed.",
  coupon_user_limit_reached: "The per-user cap has been reached.",
  coupon_login_required: "Needs a signed-in member of the group.",
  coupon_wrong_group: "Only members of the assigned group can use it.",
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface FormState {
  id: string | null;
  code: string;
  description: string;
  group_id: string;
  applies_to: CouponAppliesTo;
  discount_type: CouponDiscountType;
  discount_value: string;
  minimum_order_value: string;
  max_uses: string;
  max_uses_per_user: string;
  starts_at: string;
  ends_at: string;
  status: CouponStatus;
}

const emptyForm: FormState = {
  id: null,
  code: "",
  description: "",
  group_id: "",
  applies_to: "order",
  discount_type: "percentage",
  discount_value: "10",
  minimum_order_value: "0",
  max_uses: "",
  max_uses_per_user: "1",
  starts_at: "",
  ends_at: "",
  status: "draft",
};

export default function AdminCoupons() {
  const [coupons, setCoupons] = useState<CouponWithUsage[]>([]);
  const [groups, setGroups] = useState<UserGroupWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | CouponStatus>("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());

      const [couponRes, groupRes] = await Promise.all([
        fetch(`/api/admin/coupons?${params.toString()}`),
        fetch("/api/admin/user-groups"),
      ]);

      if (!couponRes.ok) throw new Error("Could not load coupons");
      const couponJson = await couponRes.json();
      setCoupons(couponJson.data ?? []);

      if (groupRes.ok) {
        const groupJson = await groupRes.json();
        setGroups(groupJson.data ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load coupons");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (c: CouponWithUsage) => {
    setForm({
      id: c.id,
      code: c.code,
      description: c.description ?? "",
      group_id: c.group_id ?? "",
      applies_to: c.applies_to,
      discount_type: c.discount_type,
      discount_value: String(c.discount_value),
      minimum_order_value: String(c.minimum_order_value),
      max_uses: c.max_uses === null ? "" : String(c.max_uses),
      max_uses_per_user: String(c.max_uses_per_user),
      starts_at: toLocalInput(c.starts_at),
      ends_at: toLocalInput(c.ends_at),
      status: c.status,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id ?? undefined,
          code: form.code,
          description: form.description,
          group_id: form.group_id || null,
          applies_to: form.applies_to,
          discount_type: form.discount_type,
          discount_value: Number(form.discount_value),
          minimum_order_value: Number(form.minimum_order_value),
          max_uses: form.max_uses === "" ? null : Number(form.max_uses),
          max_uses_per_user: Number(form.max_uses_per_user),
          starts_at: fromLocalInput(form.starts_at),
          ends_at: fromLocalInput(form.ends_at),
          status: form.status,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Could not save the coupon");
        return;
      }

      setModalOpen(false);
      await fetchAll();
    } catch {
      setFormError("Could not save the coupon");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/coupons?id=${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Could not delete the coupon");
        return;
      }
      setDeleteId(null);
      await fetchAll();
    } finally {
      setDeleting(false);
    }
  };

  const now = Date.now();
  const stats = useMemo(
    () => ({
      live: coupons.filter(
        (c) =>
          c.status === "active" &&
          new Date(c.starts_at).getTime() <= now &&
          new Date(c.ends_at).getTime() > now
      ).length,
      memberOnly: coupons.filter((c) => c.group_id !== null).length,
      total: coupons.length,
    }),
    [coupons, now]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Coupons</h1>
          <p className="text-xs text-text-muted mt-1">
            Member-only codes that stack on top of running promotions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/user-groups"
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-primary text-primary font-display text-[11px] uppercase tracking-wider font-bold rounded-lg hover:bg-primary hover:text-white transition-colors"
          >
            <Users className="w-3.5 h-3.5" /> User Groups
          </Link>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-display text-[11px] uppercase tracking-wider font-bold rounded-lg hover:bg-primary-container transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Coupon
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: stats.total },
          { label: "Live now", value: stats.live },
          { label: "Member-only", value: stats.memberOnly },
        ].map((s) => (
          <div key={s.label} className="bg-surface-card border border-border-light rounded-xl p-4">
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              {s.label}
            </p>
            <p className="font-display text-2xl font-bold text-primary mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border-light bg-surface-card text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | CouponStatus)}
          className="h-10 px-3 rounded-lg border border-border-light bg-surface-card text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2.5 text-xs text-badge-discount">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-muted text-xs">Loading coupons...</div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-xs">
          No coupons yet. Create one to start offering member-only discounts.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {coupons.map((c) => {
            const starts = new Date(c.starts_at).getTime();
            const ends = new Date(c.ends_at).getTime();
            const live = c.status === "active" && starts <= now && ends > now;
            const exhausted = c.max_uses !== null && c.times_used >= c.max_uses;

            return (
              <div
                key={c.id}
                className="bg-surface-card border border-border-light rounded-xl p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-primary tracking-wider">
                        {c.code}
                      </span>
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${STATUS_STYLES[c.status]}`}
                      >
                        {c.status}
                      </span>
                      {live && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                          live
                        </span>
                      )}
                      {exhausted && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                          used up
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="text-xs text-text-muted mt-1">{c.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      aria-label="Edit coupon"
                      className="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-primary"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(c.id)}
                      aria-label="Delete coupon"
                      className="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-badge-discount"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Discount</span>
                    <span className="font-semibold text-on-surface">
                      {c.discount_type === "percentage"
                        ? `${c.discount_value}%`
                        : `৳ ${c.discount_value}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Applies to</span>
                    <span className="font-semibold text-on-surface">
                      {c.applies_to === "order" ? "Whole order" : `${c.product_count} product(s)`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Audience</span>
                    <span className="font-semibold text-on-surface truncate ml-2">
                      {c.group_id ? (c.group_name ?? "Group") : "Anyone"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Used</span>
                    <span className="font-semibold text-on-surface">
                      {c.times_used}
                      {c.max_uses !== null ? ` / ${c.max_uses}` : ""}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Per user</span>
                    <span className="font-semibold text-on-surface">{c.max_uses_per_user}</span>
                  </div>
                  {c.minimum_order_value > 0 && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Min order</span>
                      <span className="font-semibold text-on-surface">
                        ৳ {c.minimum_order_value}
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-text-muted">
                  {new Date(c.starts_at).toLocaleDateString()} –{" "}
                  {new Date(c.ends_at).toLocaleDateString()}
                </p>

                {c.group_id && REJECTION_HINTS.coupon_wrong_group && (
                  <p className="text-[10px] text-text-muted flex items-start gap-1.5">
                    <Users className="w-3 h-3 mt-0.5 shrink-0" />
                    Only {c.group_name ?? "group"} members can redeem this.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light w-full max-w-2xl my-8">
            <div className="flex items-center justify-between p-5 border-b border-border-light">
              <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary flex items-center gap-2">
                <Ticket className="w-4 h-4" />
                {form.id ? "Edit coupon" : "New coupon"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
                className="p-1 rounded hover:bg-surface-subtle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4 text-xs">
              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2 text-badge-discount">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Code *</label>
                  <input
                    value={form.code}
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                    placeholder="EID2026"
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary font-mono uppercase tracking-wider"
                  />
                  <p className="text-[10px] text-text-muted mt-1">
                    3-32 characters, A-Z 0-9 - _
                  </p>
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-on-surface">
                    Audience
                  </label>
                  <select
                    value={form.group_id}
                    onChange={(e) => set("group_id", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Anyone (including guests)</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.member_count})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-text-muted mt-1">
                    A member-only code requires a signed-in shopper in the group.
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-on-surface">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Eid early-access 20% off"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Type</label>
                  <select
                    value={form.discount_type}
                    onChange={(e) => set("discount_type", e.target.value as CouponDiscountType)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="percentage">Percentage</option>
                    <option value="flat">Flat amount</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Value *</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discount_value}
                    onChange={(e) => set("discount_value", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Applies to</label>
                  <select
                    value={form.applies_to}
                    onChange={(e) => set("applies_to", e.target.value as CouponAppliesTo)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="order">Whole order</option>
                    <option value="products">Specific products</option>
                  </select>
                </div>
              </div>

              {form.applies_to === "products" && (
                <p className="text-[10px] text-text-muted bg-surface-subtle rounded-lg px-3 py-2">
                  Product selection is not wired into this form yet. Choose &ldquo;Whole
                  order&rdquo; for now, or attach products via the API.
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">
                    Min order value
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.minimum_order_value}
                    onChange={(e) => set("minimum_order_value", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">
                    Total uses (blank = unlimited)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.max_uses}
                    onChange={(e) => set("max_uses", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Uses per user</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={form.max_uses_per_user}
                    onChange={(e) => set("max_uses_per_user", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Starts *</label>
                  <input
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => set("starts_at", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Ends *</label>
                  <input
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(e) => set("ends_at", e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1 text-on-surface">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => set("status", e.target.value as CouponStatus)}
                    className="w-full h-10 px-3 rounded-lg border border-border-light bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="draft">Draft</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-border-light">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2.5 border border-border-light rounded-lg font-display text-[11px] uppercase tracking-wider font-bold text-text-muted hover:bg-surface-subtle"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-4 py-2.5 bg-primary text-white rounded-lg font-display text-[11px] uppercase tracking-wider font-bold hover:bg-primary-container disabled:opacity-50"
              >
                {saving ? "Saving..." : form.id ? "Save changes" : "Create coupon"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light p-6 w-full max-w-sm">
            <h3 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              Delete coupon?
            </h3>
            <p className="text-xs text-text-muted mt-2">
              Existing orders keep their price and code snapshots, so past invoices stay
              correct.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteId(null)}
                className="px-4 py-2.5 border border-border-light rounded-lg font-display text-[11px] uppercase tracking-wider font-bold text-text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="px-4 py-2.5 bg-badge-discount text-white rounded-lg font-display text-[11px] uppercase tracking-wider font-bold disabled:opacity-50"
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
