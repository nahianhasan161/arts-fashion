import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { UserGroupWithCount } from "@/types";

function groupErrorResponse(message: string): NextResponse {
  const map: Record<string, number> = {
    admin_required: 403,
    group_not_found: 404,
    name_required: 422,
    invalid_slug: 422,
    duplicate_group_slug: 409,
  };
  return NextResponse.json({ error: message }, { status: map[message] ?? 400 });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("user_groups")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Member counts come from one grouped query rather than N per group.
    const { data: memberRows, error: memberError } = await supabase
      .from("user_group_members")
      .select("group_id");

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const counts = new Map<string, number>();
    for (const row of memberRows ?? []) {
      counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
    }

    const groups: UserGroupWithCount[] = (data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      slug: g.slug,
      description: g.description,
      is_active: g.is_active,
      created_at: g.created_at,
      updated_at: g.updated_at,
      member_count: counts.get(g.id) ?? 0,
    }));

    return NextResponse.json({ data: groups });
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
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const payload = await request.json();
    const { data, error } = await supabase.rpc("admin_save_user_group", { payload });

    if (error) {
      return groupErrorResponse(error.message);
    }

    return NextResponse.json({ success: true, data });
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
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const payload = await request.json();
    if (!payload?.id) {
      return NextResponse.json({ error: "Group id is required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_save_user_group", { payload });

    if (error) {
      return groupErrorResponse(error.message);
    }

    return NextResponse.json({ success: true, data });
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
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Group id is required" }, { status: 400 });
    }

    // coupons.group_id is ON DELETE RESTRICT, so this fails loudly
    // rather than orphaning a member-only coupon.
    const { error } = await supabase.from("user_groups").delete().eq("id", id);

    if (error) {
      return groupErrorResponse(
        error.message.includes("coupons_group_id_fkey")
          ? "Detach the coupons using this group first."
          : error.message
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
