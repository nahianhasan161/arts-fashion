import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { describeAdminError } from "@/lib/admin/pg-error";
import { sanitizeProductHtml } from "@/lib/admin/rich-text";
import type { Product } from "@/types";

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
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;

    // The editor needs the option matrix and the promotion links for the rows
    // on this page, so both are read alongside the products. The option ids in
    // product_variants are the authority for what the matrix is; the
    // products.colors and products.sizes JSON columns are the storefront's
    // projection of it and are deliberately not trusted for authoring.
    const { data, error, count } = await supabase
      .from("products")
      .select(
        "*, product_variants(id, color_id, size_id, variant_key, sku, regular_price_override, stock, is_active, colors(name, hex), sizes(display_name)), promotion_products(promotion_id)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // The embedded rows arrive as objects, not scalars, so the list rows are
    // flattened into the plain shape the client stores. Doing it here keeps
    // the normalisation in one place instead of in every consumer.
    const products = (data ?? []).map((row) => {
      const { product_variants, promotion_products, ...product } = row as Record<string, unknown> & {
        product_variants?: {
          id: string;
          color_id: string | null;
          size_id: string | null;
          variant_key: string;
          sku: string | null;
          regular_price_override: number | null;
          stock: number;
          is_active: boolean;
          colors?: { name: string; hex: string } | null;
          sizes?: { display_name: string } | null;
        }[];
        promotion_products?: { promotion_id: string }[];
      };

      const variants = (product_variants ?? []).map((v) => ({
        ...v,
        color_name: v.colors?.name ?? null,
        color_hex: v.colors?.hex ?? null,
        size_name: v.sizes?.display_name ?? null,
        colors: undefined,
        sizes: undefined,
      }));

      return {
        ...product,
        variants,
        variant_count: variants.length,
        color_ids: variants.map((v) => v.color_id).filter((id): id is string => Boolean(id)),
        size_ids: variants.map((v) => v.size_id).filter((id): id is string => Boolean(id)),
        promotion_ids: (promotion_products ?? []).map((p) => p.promotion_id),
      } as unknown as Product;
    });

    return NextResponse.json({
      data: products,
      pagination: { page, limit, total: count ?? 0 },
    });
  } catch (error) {
    return handleAdminError(error);
  }
}

/**
 * POST and PUT are one operation: an upsert, performed entirely by
 * public.admin_save_product().
 *
 * Writing from the route instead would leave the matrix, the option links and
 * the projection out of step with the product row, and RLS would then have to
 * be trusted to express rules like "a sub-category must sit under its parent".
 * The function holds those rules, so the route only has to authenticate and
 * translate. The difference between create and update is the presence of an
 * `id` in the payload, which is why both verbs share this path.
 */
async function save(request: NextRequest) {
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

    // `images` is a projection of product_images maintained by a database
    // trigger, so it is dropped here: accepting it would let a stale form
    // payload overwrite the trigger and desynchronise the two. Media is
    // changed only through /api/admin/products/[productId]/media.
    const { images, ...payload } = body as Record<string, unknown>;
    void images;

    // An empty id means create. Normalising here keeps the two verbs'
    // difference out of the payload contract, so the form can send the same
    // shape whether it is creating or editing.
    if (payload.id === "" || payload.id === undefined) {
      delete payload.id;
    }

    // The description is rendered on storefront pages, so it is reduced to the
    // allow-list here rather than trusted because the form's editor produced
    // it. `colors` and `sizes` are dropped for the same reason: they are the
    // storefront's projection of the option matrix, and admin_save_product
    // rebuilds both from product_variants on every save.
    //
    // The three money keys the form used to send are dropped here too. The
    // function derives price and original_price from regular_price and the
    // discount, so a payload that carries them is a form still speaking the
    // old two-independent-prices model. Passing them through would be
    // harmless to the database and quietly misleading to the next reader, so
    // they are removed at the one place that already knows the real contract.
    if (typeof payload.description === "string") {
      payload.description = sanitizeProductHtml(payload.description);
    }
    for (const derived of ["colors", "sizes", "variant_count", "created_at", "updated_at", "price", "original_price", "discount_percent"]) {
      delete payload[derived];
    }

    // admin_save_product_guarded wraps admin_save_product and turns the price
    // check into a named error. The underlying function is no longer granted
    // to `authenticated`, so this is the only path in, and a caller cannot
    // reach the unguarded function to get past the check.
    const { data, error } = await supabase.rpc("admin_save_product_guarded", { p_payload: payload });

    if (error) {
      const described = describeAdminError(error);
      return NextResponse.json({ error: described.error, code: described.code }, { status: described.status });
    }

    return NextResponse.json({ success: true, data: data as { id: string; slug: string } });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function POST(request: NextRequest) {
  return save(request);
}

export async function PUT(request: NextRequest) {
  return save(request);
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
      return NextResponse.json({ error: "Product id is required" }, { status: 400 });
    }

    const { error } = await supabase.from("products").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
