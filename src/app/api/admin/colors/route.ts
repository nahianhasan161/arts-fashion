import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import type { ColorPalette } from "@/types";

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
    const categoryId = url.searchParams.get("category_id");
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

    let query = supabase
      .from("colors")
      .select("*", { count: "exact" })
      .order("is_global", { ascending: false })
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    // Filter by category_id if provided (shows global + category-specific colors)
    if (categoryId) {
      query = query.or(`category_id.eq.${categoryId},is_global.eq.true`);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: data as ColorPalette[],
      pagination: { page: Math.floor(offset / limit) + 1, limit, total: count ?? 0 },
    });
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
    const { name, hex, category_id, is_global } = body;

    if (!name || !hex) {
      return NextResponse.json({ error: "Name and hex are required" }, { status: 400 });
    }

    const { error } = await supabase.from("colors").insert([{
      id: crypto.randomUUID(),
      name,
      hex,
      category_id: category_id ?? null,
      is_global: is_global ?? false,
      display_order: 0,
    }]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Color id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("colors")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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
      return NextResponse.json({ error: "Color id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("colors").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}