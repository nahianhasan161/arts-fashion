import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { Product } from "@/types";

type Context = { params: { promotionId: string } };

export async function GET(_request: NextRequest, { params }: Context) {
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

    const { data: promotion, error: promoError } = await supabase
      .from("promotions")
      .select("*")
      .eq("id", params.promotionId)
      .maybeSingle();

    if (promoError) {
      return NextResponse.json({ error: promoError.message }, { status: 500 });
    }
    if (!promotion) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    const { data: links, error: linkError } = await supabase
      .from("promotion_products")
      .select("product_id")
      .eq("promotion_id", params.promotionId);

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    const productIds = (links ?? []).map((l) => l.product_id);
    let products: Pick<Product, "id" | "title" | "slug">[] = [];

    if (productIds.length > 0) {
      const { data: productRows } = await supabase
        .from("products")
        .select("id, title, slug")
        .in("id", productIds);
      products = (productRows ?? []) as Pick<Product, "id" | "title" | "slug">[];
    }

    return NextResponse.json({ data: { ...promotion, product_ids: productIds, products } });
  } catch (error) {
    return handleAdminError(error);
  }
}
