"use client";

import { useEffect, useState } from "react";
import {
  Shield,
  UserPlus,
  Ban,
  Trash2,
  AlertTriangle,
  Crown,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  Plus,
} from "lucide-react";
import type { UserRole, UserStatus } from "@/types";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  banned_at: string | null;
  deleted_at: string | null;
}

interface ApiResponse {
  data: AdminUser[];
  pagination: { page: number; limit: number; total: number; pages: number };
  error?: string;
}

export default function AdminUsers() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [banningId, setBanningId] = useState<{ id: string; banned: boolean } | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [callerIsSuperAdmin, setCallerIsSuperAdmin] = useState(false);

  // Pagination, filter, search state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  // Create user modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createRole, setCreateRole] = useState<UserRole>("user");
  const [createEmailVerified, setCreateEmailVerified] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Confirmation modals
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; email: string } | null>(
    null
  );
  const [confirmBan, setConfirmBan] = useState<{ id: string; email: string; banned: boolean } | null>(
    null
  );

  const fetchUsers = async (opts?: { page?: number; limit?: number; search?: string; role?: string; status?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const p = opts?.page ?? page;
      const l = opts?.limit ?? limit;
      const params = new URLSearchParams({
        page: String(p),
        limit: String(l),
      });
      if (opts?.search !== undefined ? opts.search : search) {
        params.set("search", opts?.search !== undefined ? opts.search : search);
      }
      if (opts?.role !== undefined ? opts.role : roleFilter) {
        params.set("role", opts?.role !== undefined ? opts.role : roleFilter);
      }
      if (opts?.status !== undefined ? opts.status : statusFilter) {
        params.set("status", opts?.status !== undefined ? opts.status : statusFilter);
      }

      const response = await fetch(`/api/admin/users?${params.toString()}`, {
        credentials: "include",
      });
      const data: ApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load users");
      }

      setUsers(data.data);
      if (data.pagination) {
        setTotal(data.pagination.total);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load users"
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentUser = async () => {
    try {
      const res = await fetch("/api/admin/users/me", { credentials: "include" });
      if (res.ok) {
        const { id, role } = await res.json();
        setCurrentUserId(id);
        setCallerIsSuperAdmin(role === "super_admin");
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchCurrentUser();
  }, []);

  // Re-fetch when filters/search change
  useEffect(() => {
    setPage(1);
    fetchUsers({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roleFilter, statusFilter]);

  const updateUserRole = async (id: string, role: UserRole) => {
    setPromotingId(id);
    try {
      const response = await fetch("/api/admin/users?action=role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, role }),
      });

      const data: { error?: string; success?: boolean; role?: UserRole } =
        await response.json();
      if (!response.ok) {
        toast(data.error ?? "Failed to update role", "error");
        throw new Error(data.error ?? "Failed to update role");
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, role: data.role ?? role } : u
        )
      );
      toast(`Role updated to ${data.role ?? role}`, "success");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update role"
      );
    } finally {
      setPromotingId(null);
    }
  };

  const toggleUserBan = async (id: string, currentlyBanned: boolean) => {
    // Find user to get email for confirmation
    const user = users.find((u) => u.id === id);
    if (user) {
      setConfirmBan({ id, email: user.email || "Unknown", banned: currentlyBanned });
    }
  };

  const executeToggleBan = async (id: string, currentlyBanned: boolean) => {
    setBanningId({ id, banned: !currentlyBanned });
    setConfirmBan(null);
    try {
      const response = await fetch("/api/admin/users?action=ban", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, banned: !currentlyBanned }),
      });

      const data: { error?: string; success?: boolean; status?: UserStatus } =
        await response.json();
      if (!response.ok) {
        toast(data.error ?? "Failed to update ban status", "error");
        throw new Error(data.error ?? "Failed to update ban status");
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                status: data.status ?? (!currentlyBanned ? "banned" : "active"),
                banned_at: !currentlyBanned ? new Date().toISOString() : null,
              }
            : u
        )
      );
      toast(
        !currentlyBanned ? "User banned successfully" : "User unbanned successfully",
        "success"
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to update ban status"
      );
    } finally {
      setBanningId(null);
    }
  };

  const deleteUser = async (id: string) => {
    // Find user to get email for confirmation
    const user = users.find((u) => u.id === id);
    if (user) {
      setConfirmDelete({ id, email: user.email || "Unknown" });
    }
  };

  const executeDelete = async (id: string) => {
    setDeletingId(id);
    setError(null); // Clear stale errors before attempting
    setConfirmDelete(null);
    try {
      const response = await fetch(`/api/admin/users?id=${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        toast(data.error ?? "Failed to delete user", "error");
        throw new Error(data.error ?? "Failed to delete user");
      }

      setUsers((prev) => prev.filter((u) => u.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      toast("User deleted successfully", "success");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete user"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          full_name: createFullName || undefined,
          role: createRole,
          email_verified: createEmailVerified,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to create user");
      }

      // Reset form and close modal
      setCreateEmail("");
      setCreatePassword("");
      setCreateFullName("");
      setCreateRole("user");
      setCreateEmailVerified(true);
      setShowCreateModal(false);

      // Refresh the list
      fetchUsers({ page });
      toast(
        createEmailVerified
          ? `User created — they can sign in immediately`
          : `User created — they must confirm their email`,
        "success"
      );
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create user"
      );
    } finally {
      setCreating(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchUsers({ page: newPage });
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
    fetchUsers({ page: 1, limit: newLimit });
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
  };

  const handleRoleFilterChange = (value: string) => {
    setRoleFilter(value);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
  };

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("");
    setStatusFilter("");
  };

  const isSelf = (id: string) => currentUserId !== null && id === currentUserId;
  const userIsSuperAdmin = (user: AdminUser) => user.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-primary">
          User Management
        </h2>
        <button
          onClick={() => {
            setCreateError(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create User
        </button>
      </div>

      {error && (
        <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3">
          <p className="text-badge-discount text-sm">{error}</p>
        </div>
      )}

      {/* Search + Filters */}
      <div className="bg-surface-card border border-border-light rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search by name, email, or user ID..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => handleRoleFilterChange(e.target.value)}
            className="px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Roles</option>
            <option value="user">Member</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusFilterChange(e.target.value)}
            className="px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="deleted">Deleted</option>
          </select>
          <select
            value={String(limit)}
            onChange={(e) => handleLimitChange(Number(e.target.value))}
            className="px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="10">10 / page</option>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
          {(search || roleFilter || statusFilter) && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm text-text-muted hover:text-on-surface border border-border-light rounded-lg hover:bg-surface-subtle transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-text-muted">
          Showing {users.length} of {total} user{total !== 1 ? "s" : ""}
          {search && ` matching "${search}"`}
          {roleFilter && ` with role ${roleFilter}`}
          {statusFilter && ` with status ${statusFilter}`}
        </div>
      </div>

      <div className="bg-surface-card border border-border-light rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-subtle">
              <tr>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  User
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Email
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Role
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Joined
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-light last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Skeleton className="w-8 h-8 rounded-full" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-36" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Skeleton className="h-6 w-16 rounded-full mx-auto" />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Skeleton className="h-6 w-14 rounded-full mx-auto" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Skeleton className="h-7 w-20 rounded-full" />
                        <Skeleton className="h-7 w-7 rounded" />
                        <Skeleton className="h-7 w-7 rounded" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-12 text-text-muted text-sm"
                  >
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const isBanningThisUser = banningId?.id === user.id;
                  const isDeletingThisUser = deletingId === user.id;
                  const isPromotingThisUser = promotingId === user.id;
                  const isCurrentUser = isSelf(user.id) ?? false;
                  const isUserSuperAdmin = userIsSuperAdmin(user);

                  return (
                    <tr
                      key={user.id}
                      className={`border-b border-border-light last:border-b-0 ${
                        user.status === "banned"
                          ? "opacity-60 bg-badge-discount/5"
                          : user.status === "deleted"
                          ? "opacity-40 line-through"
                          : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">
                              {user.full_name
                                ? user.full_name
                                    .split(" ")
                                    .slice(0, 2)
                                    .map((n) => n[0])
                                    .join("")
                                    .toUpperCase()
                                : user.email
                                ? user.email[0].toUpperCase() +
                                  user.email.split("@")[0][0].toUpperCase()
                                : "U"}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-on-surface text-sm">
                              {user.full_name || "No name"}
                            </p>
                            <p className="text-xs text-text-muted">
                              ID: {user.id.slice(0, 8)}…
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-on-surface">
                        {user.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === "super_admin"
                              ? "bg-purple-100 text-purple-700"
                              : user.role === "admin"
                              ? "bg-accent-gold/10 text-accent-gold"
                              : "bg-surface-subtle text-text-muted"
                          }`}
                        >
                          {user.role === "super_admin" && (
                            <Crown className="w-3 h-3" />
                          )}
                          {user.role === "admin" && (
                            <Shield className="w-3 h-3" />
                          )}
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            user.status === "active"
                              ? "bg-green-100 text-green-700"
                              : user.status === "banned"
                              ? "bg-red-100 text-red-700"
                              : "bg-surface-subtle text-text-muted"
                          }`}
                        >
                          {user.status === "banned" && (
                            <Ban className="w-3 h-3" />
                          )}
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {new Date(user.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {/* Role dropdown */}
                          <select
                            value={user.role}
                            onChange={(e) =>
                              updateUserRole(user.id, e.target.value as UserRole)
                            }
                            disabled={
                              isPromotingThisUser ||
                              isUserSuperAdmin ||
                              (isCurrentUser && user.role === "super_admin") ||
                              (user.role === "super_admin" &&
                                !userIsSuperAdmin({ ...user, role: "admin" }))
                            }
                            className={`appearance-none text-xs font-medium px-2.5 py-0.5 rounded-full border-0 bg-transparent cursor-pointer disabled:opacity-50 ${
                              user.role === "super_admin"
                                ? "bg-purple-100 text-purple-700"
                                : user.role === "admin"
                                ? "bg-accent-gold/10 text-accent-gold"
                                : "bg-surface-subtle text-text-muted"
                            }`}
                          >
                            <option value="user">Member</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                          </select>

                          {/* Ban/Unban button */}
                          {user.status !== "deleted" && (
                            <button
                              onClick={() =>
                                toggleUserBan(user.id, user.status === "banned")
                              }
                              disabled={
                                isBanningThisUser ||
                                isUserSuperAdmin ||
                                isCurrentUser
                              }
                              className={`p-1.5 rounded transition-colors ${
                                user.status === "banned"
                                  ? "text-green-600 hover:bg-green-100"
                                  : "text-orange-600 hover:bg-orange-100"
                              } disabled:opacity-40 disabled:cursor-not-allowed`}
                              title={
                                user.status === "banned"
                                  ? "Unban user"
                                  : "Ban user"
                              }
                            >
                              {user.status === "banned" ? (
                                <UserPlus className="w-4 h-4" />
                              ) : (
                                <Ban className="w-4 h-4" />
                              )}
                            </button>
                          )}

                          {/* Delete button */}
                          {user.status !== "deleted" && (
                            <button
                              onClick={() => deleteUser(user.id)}
                              disabled={
                                isDeletingThisUser ||
                                isUserSuperAdmin ||
                                isCurrentUser
                              }
                              className={`p-1.5 rounded transition-colors text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed`}
                              title="Delete user"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                          {/* Super Admin warning */}
                          {userIsSuperAdmin(user) && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-purple-700 bg-purple-50 rounded-full">
                              <AlertTriangle className="w-3 h-3" />
                              Protected
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-light">
            <div className="text-xs text-text-muted">
              Page {page} of {Math.ceil(total / limit)}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || loading}
                className="p-1.5 rounded-lg border border-border-light hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {/* Page numbers */}
              {Array.from({ length: Math.ceil(total / limit) }, (_, i) => i + 1)
                .filter((p) => Math.abs(p - page) <= 2 || p === 1 || p === Math.ceil(total / limit))
                .map((p, idx, arr) => {
                  // Insert ellipsis gaps
                  const showGapBefore = idx > 0 && p - arr[idx - 1] > 1;
                  return (
                    <span key={p} className="flex items-center">
                      {showGapBefore && (
                        <span className="px-1 text-text-muted">…</span>
                      )}
                      <button
                        onClick={() => handlePageChange(p)}
                        disabled={p === page || loading}
                        className={`min-w-[2rem] px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                          p === page
                            ? "bg-primary text-white border-primary"
                            : "border-border-light hover:bg-surface-subtle disabled:opacity-40"
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  );
                })}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= Math.ceil(total / limit) || loading}
                className="p-1.5 rounded-lg border border-border-light hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDelete(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <div
            className="bg-surface-card border border-border-light rounded-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="confirm-delete-title"
              className="font-display text-lg font-bold text-primary mb-3"
            >
              Delete User
            </h3>
            <p className="text-on-surface-variant mb-4">
              Are you sure you want to delete <strong>{confirmDelete.email}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-subtle rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={() => executeDelete(confirmDelete.id)}
                disabled={deletingId === confirmDelete.id}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {deletingId === confirmDelete.id ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmBan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmBan(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ban-title"
        >
          <div
            className="bg-surface-card border border-border-light rounded-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="confirm-ban-title"
              className="font-display text-lg font-bold text-primary mb-3"
            >
              {confirmBan.banned ? "Unban User" : "Ban User"}
            </h3>
            <p className="text-on-surface-variant mb-4">
              Are you sure you want to{" "}
              <strong>{confirmBan.banned ? "unban" : "ban"}</strong>{" "}
              <strong>{confirmBan.email}</strong>?
              {confirmBan.banned
                ? " The user will regain access to their account."
                : " The user will lose access to their account."}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmBan(null)}
                disabled={banningId?.id === confirmBan.id}
                className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-subtle rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
              <button
                onClick={() => executeToggleBan(confirmBan.id, confirmBan.banned)}
                disabled={banningId?.id === confirmBan.id}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  confirmBan.banned
                    ? "bg-green-600 hover:bg-green-700"
                    : "bg-orange-600 hover:bg-orange-700"
                }`}
              >
                {banningId?.id === confirmBan.id ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {confirmBan.banned ? "Unbanning..." : "Banning..."}
                  </>
                ) : (
                  <>
                    {confirmBan.banned ? (
                      <UserPlus className="w-4 h-4" />
                    ) : (
                      <Ban className="w-4 h-4" />
                    )}
                    {confirmBan.banned ? "Unban" : "Ban"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!creating) setShowCreateModal(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-title"
        >
          <div
            className="bg-surface-card border border-border-light rounded-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="create-user-title" className="font-display text-lg font-bold text-primary">
                Create New User
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
                className="p-2 rounded-lg text-text-muted hover:text-on-surface hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {createError && (
              <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3 mb-4">
                <p className="text-badge-discount text-sm">{createError}</p>
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  required
                  disabled={creating}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  required
                  disabled={creating}
                  placeholder="Min. 8 characters"
                  className="w-full px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={createFullName}
                  onChange={(e) => setCreateFullName(e.target.value)}
                  disabled={creating}
                  placeholder="Optional"
                  className="w-full px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  Role *
                </label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as UserRole)}
                  disabled={creating}
                  className="w-full px-3 py-2 text-sm bg-surface-subtle border border-border-light rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                >
                  <option value="user">Member</option>
                  <option value="admin">Admin</option>
                  <option value="super_admin" disabled={!callerIsSuperAdmin}>
                    Super Admin {callerIsSuperAdmin ? "" : "(Super Admin only)"}
                  </option>
                </select>
                {!callerIsSuperAdmin && (
                  <p className="text-xs text-text-muted mt-1">
                    Only Super Admins can create Super Admin accounts.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createEmailVerified}
                    onChange={(e) => setCreateEmailVerified(e.target.checked)}
                    disabled={creating}
                    className="w-4 h-4 text-primary bg-surface-subtle border-border-light rounded focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="text-sm text-on-surface">
                    Email already verified
                  </span>
                </label>
                <span className="text-xs text-text-muted">
                  {createEmailVerified ? "User can sign in immediately" : "User must confirm email"}
                </span>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-subtle rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !createEmail || !createPassword}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {creating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Create User
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}