import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { PromotionWithProducts } from "@/types";

/** Map the RPC's snake_case exception messages onto HTTP statuses. */
function promotionErrorResponse(message: string): NextResponse {
  const map: Record<string, number> = {
    admin_required: 403,
    promotion_not_found: 404,
    duplicate_promotion_name: 409,
    product_not_found: 422,
  };
  const status = map[message] ?? 400;
  return NextResponse.json({ error: message }, { status });
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
    const activeOnly = url.searchParams.get("active_only") === "true";
    const productId = url.searchParams.get("product_id");
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

    let query = supabase
      .from("promotions")
      .select("*", { count: "exact" })
      .order("starts_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }
    if (activeOnly) {
      const nowIso = new Date().toISOString();
      query = query.eq("status", "active").lte("starts_at", nowIso).gt("ends_at", nowIso);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const promotions = data ?? [];
    let links: { promotion_id: string; product_id: string }[] = [];

    if (promotions.length > 0) {
      let linkQuery = supabase
        .from("promotion_products")
        .select("promotion_id, product_id")
        .in(
          "promotion_id",
          promotions.map((p) => p.id)
        );

      if (productId) {
        linkQuery = linkQuery.eq("product_id", productId);
      }

      const linkRes = await linkQuery;
      if (linkRes.error) {
        return NextResponse.json({ error: linkRes.error.message }, { status: 500 });
      }
      links = linkRes.data ?? [];
    }

    const byPromotion = new Map<string, string[]>();
    for (const link of links) {
      const list = byPromotion.get(link.promotion_id) ?? [];
      list.push(link.product_id);
      byPromotion.set(link.promotion_id, list);
    }

    const now = Date.now();
    const result: PromotionWithProducts[] = promotions.map((p) => ({
      ...(p as Omit<PromotionWithProducts, "product_ids" | "product_count" | "is_live">),
      product_ids: byPromotion.get(p.id) ?? [],
      product_count: byPromotion.get(p.id)?.length ?? 0,
      is_live:
        p.status === "active" &&
        new Date(p.starts_at).getTime() <= now &&
        new Date(p.ends_at).getTime() > now,
    }));

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
    const { data, error } = await supabase.rpc("admin_save_promotion", { payload });

    if (error) {
      return promotionErrorResponse(error.message);
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
      return NextResponse.json({ error: "Promotion id is required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_save_promotion", { payload });

    if (error) {
      return promotionErrorResponse(error.message);
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

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Promotion id is required" }, { status: 400 });
    }

    // promotion_products cascades. order_items.promotion_id is ON DELETE SET NULL,
    // and the denormalised promotion_name snapshot keeps history readable.
    const { error } = await supabase.from("promotions").delete().eq("id", id);

    if (error) {
      return promotionErrorResponse(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
