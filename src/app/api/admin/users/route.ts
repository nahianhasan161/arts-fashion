import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
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

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, phone, address, city, avatar_url, role, updated_at")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const { data: authUsers, error: usersError } = await supabase.auth.admin.listUsers();

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const userMap = new Map(authUsers.users.map((u) => [u.id, u.email]));

    const users = (profiles as Profile[]).map((p) => ({
      id: p.id,
      email: userMap.get(p.id) ?? null,
      full_name: p.full_name,
      phone: p.phone,
      role: p.role,
      created_at: p.updated_at,
    }));

    return NextResponse.json({
      data: users,
      pagination: { page, limit, total: users.length },
    });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PUT(request: NextRequest) {
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
    const { id, role } = body;

    if (!id) {
      return NextResponse.json({ error: "User id is required" }, { status: 400 });
    }

    const validRoles: UserRole[] = ["admin", "user"];
    if (!validRoles.includes(role as UserRole)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { error } = await supabase
      .from("profiles")
      .update({ role: role as UserRole, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
