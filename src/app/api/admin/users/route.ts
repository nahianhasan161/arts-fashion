import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, requireSuperAdmin, handleAdminError } from "@/lib/admin/auth";
import type { Profile, UserRole } from "@/types";

async function getSupabase() {
  const cookieStore = cookies();
  return createSupabaseServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // Cookie writes handled by middleware
      }
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;
    const search = url.searchParams.get("search")?.trim();
    const roleFilter = url.searchParams.get("role")?.trim();
    const statusFilter = url.searchParams.get("status")?.trim();

    let query = supabase
      .from("profiles")
      .select(
        "id, full_name, phone, address, city, avatar_url, role, status, email, updated_at, banned_at, deleted_at",
        { count: "exact" }
      )
      .order("updated_at", { ascending: false });

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,email.ilike.%${search}%,id.ilike.%${search}%`
      );
    }
    if (roleFilter) {
      query = query.eq("role", roleFilter);
    }
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: profiles, error: profileError, count } = await query.range(
      offset,
      offset + limit - 1
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const users = (profiles as Profile[]).map((p) => ({
      id: p.id,
      email: p.email ?? null,
      full_name: p.full_name,
      phone: p.phone,
      role: p.role,
      status: p.status,
      created_at: p.updated_at,
      banned_at: p.banned_at,
      deleted_at: p.deleted_at,
    }));

    return NextResponse.json({
      data: users,
      pagination: {
        page,
        limit,
        total: count ?? users.length,
        pages: Math.max(1, Math.ceil((count ?? users.length) / limit)),
      },
    });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    if (action === "role") {
      // Role changes must go through the RPC so the invariant is enforced
      const { role } = body;
      const validRoles: UserRole[] = ["user", "admin", "super_admin"];
      if (!validRoles.includes(role as UserRole)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }

      const { error } = await supabase.rpc("admin_set_user_role", {
        p_user_id: id,
        p_role: role,
      });

      if (error) {
        return NextResponse.json(
          { error: mapRpcError(error) },
          { status: mapRpcStatus(error) }
        );
      }

      return NextResponse.json({ success: true, role });
    }

    if (action === "ban") {
      const { banned } = body;
      if (typeof banned !== "boolean") {
        return NextResponse.json({ error: "banned must be a boolean" }, { status: 400 });
      }

      // Super admin rows cannot have their status changed (enforced by trigger)
      const { data: target } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", id)
        .single();

      if (target?.role === "super_admin") {
        return NextResponse.json(
          { error: "Super Admin status cannot be changed" },
          { status: 403 }
        );
      }

      const newStatus = banned ? "banned" : "active";
      const { error } = await supabase
        .from("profiles")
        .update({
          status: newStatus,
          banned_at: banned ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, status: newStatus });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { id, role } = body;

    if (!id || !role) {
      return NextResponse.json({ error: "User id and role are required" }, { status: 400 });
    }

    const validRoles: UserRole[] = ["user", "admin", "super_admin"];
    if (!validRoles.includes(role as UserRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { error } = await supabase.rpc("admin_set_user_role", {
      p_user_id: id,
      p_role: role,
    });

    if (error) {
      return NextResponse.json(
        { error: mapRpcError(error) },
        { status: mapRpcStatus(error) }
      );
    }

    return NextResponse.json({ success: true, role });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { email, password, full_name, role, email_verified } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // Role boundary: a regular Admin can only create 'user' roles.
    // A Super Admin can create 'user' or 'admin'.
    const validRoles: UserRole[] = ["user", "admin"];
    const requestedRole = (role as UserRole) ?? "user";
    if (!validRoles.includes(requestedRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_create_user", {
      p_email: email,
      p_password: password,
      p_full_name: full_name ?? null,
      p_role: requestedRole,
      p_email_verified: email_verified === true,
    });

    if (error) {
      return NextResponse.json(
        { error: mapRpcError(error) },
        { status: mapRpcStatus(error) }
      );
    }

    return NextResponse.json({ success: true, user: data }, { status: 201 });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    // Validate UUID format before hitting the database. A malformed ID
    // would otherwise surface as a misleading 404 (pre-check misses) or
    // a 500 (RPC cast fails).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }

    // The RPC is the single source of truth. It re-checks the profile,
    // raises P0005 if the user does not exist, and P0002 if the target
    // is a super_admin. Removing the separate pre-check eliminates a
    // TOCTOU window where another process could delete the user between
    // the check and the RPC call.
    const { data, error } = await supabase.rpc("admin_delete_user", {
      p_user_id: id,
    });

    if (error) {
      return NextResponse.json(
        { error: mapRpcError(error) },
        { status: mapRpcStatus(error) }
      );
    }

    return NextResponse.json({ success: true, deleted: data });
  } catch (error) {
    return handleAdminError(error);
  }
}

// Map RPC error codes to HTTP status and user-facing messages
function mapRpcError(error: { code?: string; message?: string }): string {
  const code = error.code ?? "";
  const message = error.message ?? "";

  switch (code) {
    case "P0001": // invariant violation
      return "Operation would leave zero Super Admins";
    case "P0002": // delete super_admin
      return "Cannot delete a Super Admin";
    case "P0003": // role change on super_admin
      return "Super Admin role can only be changed via admin_set_user_role()";
    case "P0004": // status change on super_admin
      return "Super Admin status cannot be changed";
    case "P0005": // target not found
      return "User not found";
    case "P0006": // self demotion
      return "You cannot demote yourself from Super Admin";
    case "P0007": // last super_admin demoted
      return "Cannot demote the last Super Admin";
    case "P0008": // cannot create super_admin
      return "Cannot create a Super Admin from this endpoint";
    case "42501": // super_admin_required
      return "Super Admin access required";
    case "22023": // invalid_role
      return "Invalid role";
    case "23505": // duplicate key
      return "Email already in use";
    default:
      return message || "Operation failed";
  }
}

function mapRpcStatus(error: { code?: string }): number {
  const code = error.code ?? "";
  switch (code) {
    case "P0001": // invariant violation - would leave zero Super Admins
    case "P0006": // self demotion
    case "P0007": // last super_admin demoted
      return 409; // Conflict
    case "P0002": // delete super_admin - forbidden, not a conflict
    case "P0003": // role change on super_admin - forbidden
    case "P0004": // status change on super_admin - forbidden
    case "42501": // super_admin_required
    case "P0008": // cannot create super_admin - forbidden
      return 403; // Forbidden
    case "P0005": // target not found
      return 404;
    case "22023": // invalid_role
    case "23505": // duplicate key
      return 400;
    default:
      return 500;
  }
}