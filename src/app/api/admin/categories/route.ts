import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import type { Category } from "@/types";

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

function buildTree(categories: Category[]): Category[] {
  const map = new Map<string, Category>();
  const roots: Category[] = [];

  categories.forEach((cat) => {
    map.set(cat.id, { ...cat, children: [], depth: 0 });
  });

  categories.forEach((cat) => {
    const node = map.get(cat.id);
    if (!node) return;

    if (cat.parent_id && map.has(cat.parent_id)) {
      const parent = map.get(cat.parent_id);
      if (parent) {
        node.depth = (parent.depth ?? 0) + 1;
        parent.children = parent.children ?? [];
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots.sort((a, b) => a.name.localeCompare(b.name));
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
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const parentId = url.searchParams.get("parent_id");
    const categoryId = url.searchParams.get("id");

    let query = supabase.from("categories").select("*", { count: "exact" });

    // Filter by parent_id (for subcategories) or id (for single category)
    if (categoryId) {
      query = query.eq("id", categoryId);
    } else if (parentId) {
      query = query.eq("parent_id", parentId);
    }

    const { data, error, count } = await query.order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If filtering by id, return single category wrapped in array
    if (categoryId) {
      const singleCategory = data && data.length > 0 ? data[0] : null;
      return NextResponse.json({
        data: [singleCategory].filter(Boolean) as Category[],
        pagination: { page, limit, total: data?.length ?? 0 },
      });
    }

    const tree = buildTree(data as Category[]);
    const total = count ?? data.length;

    return NextResponse.json({
      data: tree as Category[],
      pagination: { page, limit, total },
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

    const { error } = await supabase.from("categories").insert([{
      ...body,
      id: crypto.randomUUID(),
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
      return NextResponse.json({ error: "Category id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("categories").update(updates).eq("id", id);

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
      return NextResponse.json({ error: "Category id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("categories").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
