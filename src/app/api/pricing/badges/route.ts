import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Live promotion badge + effective price for the given products.
 *
 * Backs the storefront so the discount label and price come from the
 * promotion that is actually running, instead of the static
 * products.badge string, which can outlive its promotion.
 *
 * GET /api/pricing/badges?product_ids=a,b,c
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get("product_ids") ?? "";
    const productIds = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);

    if (productIds.length === 0) {
      return NextResponse.json({ data: {} });
    }

    const { data, error } = await supabase.rpc("get_effective_badges", {
      p_product_ids: productIds,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Keyed by product id so callers can look up in O(1).
    const byProduct: Record<string, unknown> = {};
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      byProduct[String(r.product_id)] = {
        badge_label: r.badge_label,
        badge_type: r.badge_type,
        discount_percent: r.discount_percent,
        base_price: Number(r.base_price),
        final_price: Number(r.final_price),
        promotion_id: r.promotion_id,
        promotion_name: r.promotion_name,
      };
    }

    return NextResponse.json({ data: byProduct });
  } catch (error) {
    console.error("Unexpected badges error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
