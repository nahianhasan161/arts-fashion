import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Promotion } from "@/types";

/**
 * Public list of promotions that are live right now.
 * Used by the storefront to label products.
 *
 * GET /api/promotions/active?product_ids=a,b,c
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const productIdsParam = url.searchParams.get("product_ids");
    const nowIso = new Date().toISOString();

    let query = supabase
      .from("promotions")
      .select("*")
      .eq("status", "active")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("discount_value", { ascending: false });

    if (productIdsParam) {
      const productIds = productIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (productIds.length > 0) {
        const { data: links, error: linkError } = await supabase
          .from("promotion_products")
          .select("promotion_id, product_id")
          .in("product_id", productIds);

        if (linkError) {
          return NextResponse.json({ error: linkError.message }, { status: 500 });
        }

        const ids = Array.from(new Set((links ?? []).map((l) => l.promotion_id)));
        if (ids.length === 0) {
          return NextResponse.json({ data: [], product_ids: {} });
        }
        query = query.in("id", ids);
      }
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const promotions = (data ?? []) as Promotion[];

    // product_id -> the promotion currently winning for it
    const productIds: Record<string, { id: string; name: string; badge_label: string | null }> = {};
    if (promotions.length > 0) {
      const { data: links } = await supabase
        .from("promotion_products")
        .select("promotion_id, product_id")
        .in(
          "promotion_id",
          promotions.map((p) => p.id)
        );

      for (const link of links ?? []) {
        const promo = promotions.find((p) => p.id === link.promotion_id);
        if (promo && !productIds[link.product_id]) {
          productIds[link.product_id] = {
            id: promo.id,
            name: promo.name,
            badge_label: promo.badge_label,
          };
        }
      }
    }

    return NextResponse.json({ data: promotions, product_ids: productIds });
  } catch (error) {
    console.error("Unexpected active promotions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
