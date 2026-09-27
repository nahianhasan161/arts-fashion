import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { CouponWithUsage } from "@/types";

/** Map the RPC's snake_case exception messages onto HTTP statuses. */
function couponErrorResponse(message: string): NextResponse {
  const map: Record<string, number> = {
    admin_required: 403,
    coupon_not_found: 404,
    group_not_found: 422,
    code_required: 422,
    invalid_coupon_code: 422,
    invalid_window: 422,
    invalid_discount_value: 422,
    invalid_applies_to: 422,
    invalid_status: 422,
    invalid_max_uses: 422,
    invalid_slug: 422,
    products_required: 422,
    timeframe_required: 422,
    duplicate_coupon_code: 409,
  };
  return NextResponse.json({ error: message }, { status: map[message] ?? 400 });
}

export async function GET(request: NextRequest) {
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

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("search")?.trim();
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

    let query = supabase
      .from("coupons")
      .select("*, user_groups ( id, name )", { count: "exact" })
      .order("starts_at", { ascending: false });

    if (status) query = query.eq("status", status);
    // Stored upper-case, so match the caller's casing.
    if (search) query = query.ilike("code", `%${search.toUpperCase()}%`);

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const coupons = data ?? [];
    const now = Date.now();

    let links: { coupon_id: string; product_id: string }[] = [];
    const usage = new Map<string, number>();

    if (coupons.length > 0) {
      const ids = coupons.map((c) => c.id);

      const linkRes = await supabase
        .from("coupon_products")
        .select("coupon_id, product_id")
        .in("coupon_id", ids);
      links = linkRes.data ?? [];

      // Redemptions on cancelled orders are excluded, matching
      // coupon_ineligibility_reason() so the admin figure and the limit
      // enforced at checkout agree.
      const usageRes = await supabase
        .from("coupon_redemptions")
        .select("coupon_id, orders!inner(status)")
        .in("coupon_id", ids)
        .neq("orders.status", "cancelled");

      if (usageRes.error) {
        return NextResponse.json({ error: usageRes.error.message }, { status: 500 });
      }

      for (const row of usageRes.data ?? []) {
        usage.set(row.coupon_id, (usage.get(row.coupon_id) ?? 0) + 1);
      }
    }

    const byCoupon = new Map<string, string[]>();
    for (const link of links) {
      const list = byCoupon.get(link.coupon_id) ?? [];
      list.push(link.product_id);
      byCoupon.set(link.coupon_id, list);
    }

    const result: CouponWithUsage[] = coupons.map((c) => {
      const group = c.user_groups as unknown as { id: string; name: string } | null;
      return {
        id: c.id,
        code: c.code,
        description: c.description,
        group_id: c.group_id,
        group_name: group?.name ?? null,
        applies_to: c.applies_to,
        discount_type: c.discount_type,
        discount_value: Number(c.discount_value),
        minimum_order_value: Number(c.minimum_order_value),
        max_uses: c.max_uses,
        max_uses_per_user: c.max_uses_per_user,
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        status: c.status,
        created_at: c.created_at,
        updated_at: c.updated_at,
        product_ids: byCoupon.get(c.id) ?? [],
        product_count: byCoupon.get(c.id)?.length ?? 0,
        is_live:
          c.status === "active" &&
          new Date(c.starts_at).getTime() <= now &&
          new Date(c.ends_at).getTime() > now,
        times_used: usage.get(c.id) ?? 0,
      };
    });

    return NextResponse.json({
      data: result,
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
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const payload = await request.json();
    const { data, error } = await supabase.rpc("admin_save_coupon", { payload });

    if (error) {
      return couponErrorResponse(error.message);
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
      return NextResponse.json({ error: "Coupon id is required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_save_coupon", { payload });

    if (error) {
      return couponErrorResponse(error.message);
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
      return NextResponse.json({ error: "Coupon id is required" }, { status: 400 });
    }

    // coupon_products and coupon_redemptions cascade. orders.coupon_id
    // and order_items.coupon_id are ON DELETE SET NULL, and the
    // coupon_code snapshot keeps old invoices readable.
    const { error } = await supabase.from("coupons").delete().eq("id", id);

    if (error) {
      return couponErrorResponse(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
