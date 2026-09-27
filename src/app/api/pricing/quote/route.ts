import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PricingQuote, PricingQuoteLine } from "@/types";

/**
 * Server-authoritative cart pricing.
 *
 * All money is computed in Postgres by get_effective_prices() so the
 * browser can never assert its own price or discount. The client sends
 * only product ids and quantities.
 *
 * POST /api/pricing/quote
 *   { items: [{ product_id, quantity }] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const items: Array<{ product_id?: string; quantity?: number }> = Array.isArray(body?.items)
      ? body.items
      : [];

    if (items.length === 0) {
      return NextResponse.json({ error: "items is required" }, { status: 400 });
    }
    if (items.length > 200) {
      return NextResponse.json({ error: "Too many items" }, { status: 400 });
    }

    const productIds: string[] = [];
    const quantities = new Map<string, number>();

    for (const item of items) {
      const id = typeof item?.product_id === "string" ? item.product_id.trim() : "";
      const qty = Math.floor(Number(item?.quantity));
      if (!id || !Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json(
          { error: "Each item needs a product_id and a positive integer quantity" },
          { status: 400 }
        );
      }
      if (qty > 999) {
        return NextResponse.json({ error: "Quantity is too large" }, { status: 400 });
      }
      if (!quantities.has(id)) productIds.push(id);
      quantities.set(id, (quantities.get(id) ?? 0) + qty);
    }

    const { data, error } = await supabase.rpc("get_effective_prices", {
      p_product_ids: productIds,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const found = new Map(rows.map((r) => [String(r.product_id), r]));

    const lines: PricingQuoteLine[] = [];
    const missing: string[] = [];

    for (const [productId, quantity] of Array.from(quantities.entries())) {
      const row = found.get(productId);
      if (!row) {
        missing.push(productId);
        continue;
      }
      const finalPrice = Number(row.final_price);
      const basePrice = Number(row.base_price);

      lines.push({
        product_id: productId,
        regular_price: Number(row.regular_price),
        base_price: basePrice,
        final_price: finalPrice,
        discount_type: String(row.discount_type),
        discount_value: Number(row.discount_value),
        promotion_id: (row.promotion_id as string | null) ?? null,
        promotion_name: (row.promotion_name as string | null) ?? null,
        source: row.source as PricingQuoteLine["source"],
        quantity,
        line_total: Number((finalPrice * quantity).toFixed(2)),
        line_base_total: Number((basePrice * quantity).toFixed(2)),
        line_discount_total: Number(((basePrice - finalPrice) * quantity).toFixed(2)),
      });
    }

    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Unknown product in cart", product_ids: missing },
        { status: 422 }
      );
    }

    const subtotal = Number(lines.reduce((sum, l) => sum + l.line_total, 0).toFixed(2));
    const discountTotal = Number(lines.reduce((sum, l) => sum + l.line_discount_total, 0).toFixed(2));

    const quote: PricingQuote = { lines, subtotal, discount_total: discountTotal };

    return NextResponse.json({ data: quote });
  } catch (error) {
    console.error("Unexpected pricing quote error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
