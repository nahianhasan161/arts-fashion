import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CouponQuote } from "@/types";

/**
 * POST /api/coupons/validate
 *
 * Live feedback for the checkout coupon field. Body:
 *   { code: string, items: [{ product_id, quantity }] }
 *
 * Everything is decided by the validate_coupon() RPC, which judges the
 * caller's own entitlement against auth.uid(). This route deliberately
 * adds no eligibility logic of its own: a second implementation here
 * would be one more place for the checkout UI and the order RPC to
 * disagree about whether a coupon is valid.
 *
 * Always 200. A rejected coupon is a normal answer, not a transport
 * error, and the caller branches on `valid`/`reason`.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const code = typeof body?.code === "string" ? body.code : "";
    const rawItems: { product_id?: unknown; quantity?: unknown }[] = Array.isArray(body?.items)
      ? body.items
      : [];

    const items = rawItems
      .map((i) => {
        const productId = typeof i?.product_id === "string" ? i.product_id : "";
        const quantity = Number(i?.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0) return null;
        return { product_id: productId, quantity };
      })
      .filter((i): i is { product_id: string; quantity: number } => i !== null);

    if (code.trim() === "") {
      return NextResponse.json<CouponQuote>({ valid: false, reason: "coupon_empty" });
    }

    const cookieStore = cookies();
    const supabase = createSupabaseServerClient({
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        // Read-only here; the middleware refreshes the session.
      },
    });

    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const { data, error } = await supabase.rpc("validate_coupon", {
      p_code: code,
      p_items: items,
    });

    if (error) {
      console.error("validate_coupon failed:", error);
      return NextResponse.json({ error: "Could not validate coupon" }, { status: 500 });
    }

    return NextResponse.json<CouponQuote>(data as CouponQuote);
  } catch (error) {
    console.error("Unexpected coupon validation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
