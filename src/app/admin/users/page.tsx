"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import type { UserRole } from "@/types";

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
}

interface ApiResponse {
  data: AdminUser[];
  pagination: { page: number; limit: number; total: number };
  error?: string;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/users?limit=100");
      const data: ApiResponse = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load users");
      }

      setUsers(data.data);
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

  useEffect(() => {
    fetchUsers();
  }, []);

  const updateUserRole = async (id: string, role: UserRole) => {
    setPromotingId(id);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      });

      const data: { error?: string; success?: boolean } = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to update role");
      }

      setUsers((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, role: role as UserRole } : u
        )
      );
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-primary">
          User Management
        </h2>
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
                  User
                </th>
                <th className="text-left text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Email
                </th>
                <th className="text-center text-xs font-semibold text-text-muted uppercase tracking-wider px-4 py-3">
                  Role
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
                <tr>
                  <td colSpan={5} className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto"></div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center py-12 text-text-muted text-sm"
                  >
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border-light last:border-b-0"
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
                                  ? user.email[0]
                                      .toUpperCase() + user.email.split("@")[0][0]
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
                          user.role === "admin"
                            ? "bg-accent-gold/10 text-accent-gold"
                            : "bg-surface-subtle text-text-muted"
                        }`}
                      >
                        {user.role === "admin" && (
                          <Shield className="w-3 h-3" />
                        )}
                        {user.role}
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
                      <div className="relative">
                        <select
                          value={user.role}
                          onChange={(e) =>
                            updateUserRole(
                              user.id,
                              e.target.value as UserRole
                            )
                          }
                          disabled={promotingId === user.id}
                          className={`appearance-none text-xs font-medium px-2.5 py-0.5 rounded-full border-0 bg-transparent cursor-pointer disabled:opacity-50 ${
                            user.role === "admin"
                              ? "bg-accent-gold/10 text-accent-gold"
                              : "bg-surface-subtle text-text-muted"
                          }`}
                        >
                          <option value="user">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
