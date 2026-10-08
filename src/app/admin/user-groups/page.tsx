"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Edit,
  Trash2,
  X,
  Users,
  UserPlus,
  AlertCircle,
  UserCheck,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import type { GroupMember, UserGroupDetail, UserGroupWithCount } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

interface FormState {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  id: null,
  name: "",
  slug: "",
  description: "",
  is_active: true,
};

/** Derive a URL-safe slug, matching admin_save_user_group()'s fallback. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AdminUserGroups() {
  const [groups, setGroups] = useState<UserGroupWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [memberGroup, setMemberGroup] = useState<UserGroupDetail | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/user-groups");
      if (!res.ok) throw new Error("Could not load user groups");
      const json = await res.json();
      setGroups(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load user groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openCreate = () => {
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (g: UserGroupWithCount) => {
    setForm({
      id: g.id,
      name: g.name,
      slug: g.slug,
      description: g.description ?? "",
      is_active: g.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Keep the slug in step with the name until it is edited directly.
      if (k === "name" && !next.id) next.slug = slugify(v as string);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/user-groups", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Could not save the group");
        return;
      }
      setModalOpen(false);
      await fetchAll();
    } catch {
      setFormError("Could not save the group");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/user-groups?id=${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Could not delete the group");
        return;
      }
      setDeleteId(null);
      await fetchAll();
    } finally {
      setDeleting(false);
    }
  };

  const openMembers = async (groupId: string) => {
    setMemberError(null);
    setUnmatched([]);
    setMemberInput("");
    try {
      const res = await fetch(`/api/admin/user-groups/${groupId}`);
      if (!res.ok) throw new Error("Could not load members");
      const json = await res.json();
      setMemberGroup(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members");
    }
  };

  const addMembers = async () => {
    if (!memberGroup) return;

    const emails = memberInput
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length === 0) return;

    setMemberBusy(true);
    setMemberError(null);
    setUnmatched([]);

    try {
      // Membership is replaced, not appended, so send the existing set too.
      const existing = memberGroup.members
        .map((m) => m.email)
        .filter((e): e is string => Boolean(e));
      const merged = Array.from(new Set(existing.concat(emails)));

      const res = await fetch(`/api/admin/user-groups/${memberGroup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: merged }),
      });
      const json = await res.json();

      if (!res.ok) {
        setMemberError(json.error ?? "Could not update membership");
        return;
      }

      setUnmatched(json.data?.unmatched_emails ?? []);
      setMemberInput("");
      await openMembers(memberGroup.id);
      await fetchAll();
    } catch {
      setMemberError("Could not update membership");
    } finally {
      setMemberBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    if (!memberGroup) return;
    setMemberBusy(true);
    try {
      const res = await fetch(
        `/api/admin/user-groups/${memberGroup.id}?user_id=${userId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const json = await res.json();
        setMemberError(json.error ?? "Could not remove the member");
        return;
      }
      await openMembers(memberGroup.id);
      await fetchAll();
    } finally {
      setMemberBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">User Groups</h1>
          <p className="text-xs text-text-muted mt-1">
            Customer segments that member-only coupons can be restricted to.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/coupons"
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-primary text-primary font-display text-[11px] uppercase tracking-wider font-bold rounded-lg hover:bg-primary hover:text-white transition-colors"
          >
            <Ticket className="w-3.5 h-3.5" /> Coupons
          </Link>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-display text-[11px] uppercase tracking-wider font-bold rounded-lg hover:bg-primary-container transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New Group
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2.5 text-xs text-badge-discount">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-surface-card border border-border-light rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="mt-3 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-xs">
          No user groups yet. Create one to target coupons at a segment.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map((g) => (
            <div
              key={g.id}
              className="bg-surface-card border border-border-light rounded-xl p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-primary">{g.name}</span>
                    {!g.is_active && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-text-muted mt-0.5">{g.slug}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(g)}
                    aria-label="Edit group"
                    className="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-primary"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteId(g.id)}
                    aria-label="Delete group"
                    className="p-1.5 rounded hover:bg-surface-subtle text-text-muted hover:text-badge-discount"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {g.description && <p className="text-xs text-text-muted">{g.description}</p>}

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-muted flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  {g.member_count} member{g.member_count === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => void openMembers(g.id)}
                  className="text-[11px] font-bold text-primary underline"
                >
                  Manage members
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light w-full max-w-lg my-8">
            <div className="flex items-center justify-between p-5 border-b border-border-light">
              <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary flex items-center gap-2">
                <Users className="w-4 h-4" />
                {form.id ? "Edit group" : "New group"}
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

              <div>
                <label className="block font-semibold mb-1 text-on-surface">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="VIP Customers"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-on-surface">Slug</label>
                <input
                  value={form.slug}
                  onChange={(e) => set("slug", slugify(e.target.value))}
                  placeholder="vip-customers"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-on-surface">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Repeat buyers from the last 12 months"
                  className="w-full h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                  className="accent-primary"
                />
                <span className="font-semibold text-on-surface">Active</span>
              </label>
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
                {saving ? "Saving..." : form.id ? "Save changes" : "Create group"}
              </button>
            </div>
          </div>
        </div>
      )}

      {memberGroup && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light w-full max-w-lg my-8">
            <div className="flex items-center justify-between p-5 border-b border-border-light">
              <h2 className="font-display text-sm uppercase tracking-wider font-bold text-primary flex items-center gap-2">
                <UserCheck className="w-4 h-4" />
                {memberGroup.name} &middot; members
              </h2>
              <button
                type="button"
                onClick={() => setMemberGroup(null)}
                aria-label="Close"
                className="p-1 rounded hover:bg-surface-subtle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4 text-xs">
              {memberError && (
                <div className="flex items-center gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2 text-badge-discount">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {memberError}
                </div>
              )}

              <div>
                <label className="block font-semibold mb-1 text-on-surface">
                  Add by email
                </label>
                <div className="flex gap-2">
                  <input
                    value={memberInput}
                    onChange={(e) => setMemberInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addMembers();
                      }
                    }}
                    placeholder="a@example.com, b@example.com"
                    className="flex-1 h-10 px-3 rounded-lg border border-border-light focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => void addMembers()}
                    disabled={memberBusy || memberInput.trim() === ""}
                    className="h-10 px-4 rounded-lg bg-primary text-white font-display text-[11px] uppercase tracking-wider font-bold disabled:opacity-50"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  Separate multiple addresses with commas. Addresses with no account are
                  reported back.
                </p>
              </div>

              {unmatched.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  No account found for: {unmatched.join(", ")}
                </div>
              )}

              <div className="border-t border-border-light pt-3">
                <p className="font-semibold text-on-surface mb-2">
                  Current members ({memberGroup.members.length})
                </p>
                {memberGroup.members.length === 0 ? (
                  <p className="text-text-muted">No members yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                    {memberGroup.members.map((m: GroupMember) => (
                      <li
                        key={m.user_id}
                        className="flex items-center justify-between gap-2 bg-surface-subtle rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-on-surface truncate">
                            {m.full_name ?? "Unnamed"}
                          </p>
                          <p className="text-[10px] text-text-muted truncate">
                            {m.email ?? m.user_id}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeMember(m.user_id)}
                          disabled={memberBusy}
                          aria-label="Remove member"
                          className="p-1.5 rounded text-text-muted hover:text-badge-discount shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-end p-5 border-t border-border-light">
              <button
                type="button"
                onClick={() => setMemberGroup(null)}
                className="px-4 py-2.5 bg-primary text-white rounded-lg font-display text-[11px] uppercase tracking-wider font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light p-6 w-full max-w-sm">
            <h3 className="font-display text-sm uppercase tracking-wider font-bold text-primary">
              Delete group?
            </h3>
            <p className="text-xs text-text-muted mt-2">
              Coupons restricted to this group must be reassigned first. Members lose any
              access they had to its codes.
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
