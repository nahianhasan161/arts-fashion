import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { describeAdminError } from "@/lib/admin/pg-error";
import { sanitizeProductHtml } from "@/lib/admin/rich-text";
import { isProductGender, type Product } from "@/types";

/** Narrows an arbitrary query string to a status the database will accept. */
function isProductStatus(value: string): value is "draft" | "published" | "archived" {
  return value === "draft" || value === "published" || value === "archived";
}

/**
 * Most product ids a search term may resolve to before the SKU disjunct is
 * dropped. See the search block in GET: `id.in.(...)` travels in the URL, and
 * 36 characters per uuid stops being a reasonable request length long before
 * the result stops being useless.
 */
const SKU_ID_CAP = 200;

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
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;

    // Retired products are hidden by default. They are still rows, and
    // listing them next to live ones would have an admin re-saving a product
    // that no longer sells without knowing why. `?deleted=1` is how the trash
    // view asks for them, and is the only way an admin can find a product to
    // restore through this route.
    const includeDeleted = url.searchParams.get("deleted") === "1";

    // ------------------------------------------------------------------
    // Filtering happens here rather than in the browser.
    //
    // It used to happen in the page, over the first 100 products the route
    // happened to return, matching on title and slug only. So a search could
    // not find a product by SKU, category, audience or status; and any product
    // past the hundredth was invisible to it entirely, with nothing in the UI
    // to say so. Both are the same mistake -- filtering a page of results as
    // though it were all of them.
    //
    // Every predicate below is a real query, so the total that comes back is
    // the total that matches, and the page size is a window onto it rather
    // than a ceiling.
    // ------------------------------------------------------------------
    const q = url.searchParams;

    // The single place the allowed sort keys are spelled out. A value that is
    // not in here falls back rather than reaching the query builder, so a
    // crafted ?sort= cannot become a column reference.
    const SORTS = {
      newest: { column: "created_at", ascending: false },
      oldest: { column: "created_at", ascending: true },
      updated: { column: "updated_at", ascending: false },
      title_asc: { column: "title", ascending: true },
      title_desc: { column: "title", ascending: false },
      price_asc: { column: "price", ascending: true },
      price_desc: { column: "price", ascending: false },
      stock_asc: { column: "stock", ascending: true },
      stock_desc: { column: "stock", ascending: false },
    } as const;
    type SortKey = keyof typeof SORTS;
    const sortKey = (q.get("sort") ?? "newest") as SortKey;
    const sort = SORTS[sortKey] ?? SORTS.newest;

    const search = (q.get("search") ?? "").trim();
    const gender = (q.get("gender") ?? "").trim();
    const status = (q.get("status") ?? "").trim();
    const categoryId = q.get("category_id") ?? "";
    const subCategoryId = q.get("sub_category_id") ?? "";
    const featured = q.get("featured") ?? "";
    const minPrice = q.get("min_price") ?? "";
    const maxPrice = q.get("max_price") ?? "";
    // "in" is any stock, "low" is at or below the threshold, "out" is zero.
    const stockState = (q.get("stock_state") ?? "").trim();
    const LOW_STOCK = 5;

    // A filter value that is not recognised is an error, not an ignored
    // parameter. Letting it fall through would apply no predicate at all, so
    // `?gender=unisex` answered with the entire catalogue as though everything
    // had satisfied the filter -- the one outcome a filtered table must never
    // produce, because it looks like a correct result. Rejected before the query
    // is built so it costs nothing to be strict about.
    if (gender && !isProductGender(gender) && gender !== "none") {
      return NextResponse.json(
        {
          error: `Unknown gender filter "${gender}". Expected one of men, women, kids, none.`,
          code: "invalid_gender_filter",
        },
        { status: 400 }
      );
    }

    // The editor needs the option matrix and the promotion links for the rows
    // on this page, so both are read alongside the products. The option ids in
    // product_variants are the authority for what the matrix is; the
    // products.colors and products.sizes JSON columns are the storefront's
    // projection of it and are deliberately not trusted for authoring.
    let listQuery = supabase
      .from("products")
      .select(
        "*, product_variants(id, color_id, size_id, variant_key, sku, regular_price_override, stock, is_active, colors(name, hex), sizes(display_name)), promotion_products(promotion_id)",
        { count: "exact" }
      )
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      // A stable tiebreak. Without it, two products with the same sort key
      // come back in an order Postgres does not promise, and paging through
      // them can repeat or skip a row between pages.
      .order("id", { ascending: true });

    // The window is applied at the end rather than in the chain above, because
    // the same query is asked twice when the page requested turns out to be
    // past the end of the results.

    // is() is not skipped when includeDeleted is false: a null filter is what
    // selects the live rows, and omitting it would return the retired ones too.
    if (!includeDeleted) {
      listQuery = listQuery.is("deleted_at", null);
    }

    // Search covers the fields an admin would actually type to find something:
    // the two human-facing strings, the SKU of any variant, and the taxonomy.
    // A free-text search that only matches the title is the reason people fall
    // back to scrolling.
    if (search) {
      // Commas and parentheses are PostgREST's own filter separators inside
      // .or(), so a search for "cotton, 100%" would otherwise be parsed as two
      // conditions and return nothing rather than searching for the text.
      const term = search.replace(/[,()%]/g, " ").replace(/\s+/g, " ").trim();
      if (term) {
        const like = `%${term}%`;

        // A variant's SKU is a column of product_variants, not of products, and
        // PostgREST's .or() can only name columns of the table being queried.
        // Writing the SKU into it does not return nothing -- it is a parse
        // error:
        //
        //   PGRST100  failed to parse logic tree
        //
        // which surfaced as a 500 on every request that carried a search box at
        // all, so the search that was added to replace scrolling was itself
        // broken. Filtering an embedded resource works at the top level
        // (`product_variants.sku=ilike.*x*`) but that ANDs with the product's
        // own columns rather than ORing with them, which is the wrong
        // predicate: a product whose SKU matches but whose title does not would
        // be excluded.
        //
        // So the SKU half is resolved first, into a set of product ids, and
        // folded back in as `id.in.(...)`. `id` is a real column of products, so
        // the combined predicate parses, and the match set is the union the
        // search box advertises.
        const { data: skuHits, error: skuError } = await supabase
          .from("product_variants")
          .select("product_id")
          .ilike("sku", like)
          .limit(SKU_ID_CAP + 1);

        if (skuError) {
          return NextResponse.json({ error: skuError.message }, { status: 500 });
        }

        // De-duplicated because a term matching many variants of one product
        // returns that product's id once per variant row.
        const skuIds = Array.from(
          new Set((skuHits ?? []).map((r) => r.product_id as string | null).filter((id): id is string => Boolean(id)))
        );

        // Over the cap the disjunct is dropped rather than sent: `id.in.(...)`
        // is part of the URL, and a few hundred thousand characters of uuid is
        // a request that gets rejected before it is a search. It only bites on
        // a term generic enough to match a thousand-plus SKUs, and for those the
        // product's own text is the useful half anyway. The cap is fetched with
        // one extra row so "exactly at the cap" is distinguishable from "past
        // it".
        const bySku =
          skuIds.length > 0 && skuIds.length <= SKU_ID_CAP
            ? `,id.in.(${skuIds.join(",")})`
            : "";

        listQuery = listQuery.or(
          `title.ilike.${like},slug.ilike.${like},` +
            `short_description.ilike.${like},category.ilike.${like},sub_category.ilike.${like}${bySku}`,
        );
      }
    }

    // "none" is a value, not an absence: it is the bucket for products an admin
    // has not assigned an audience to yet, and filtering for it has to be
    // possible or those products are unreachable by audience. Anything else was
    // refused above, so this cannot silently degrade into no filter.
    if (gender) {
      if (isProductGender(gender)) {
        listQuery = listQuery.eq("gender", gender);
      } else {
        listQuery = listQuery.is("gender", null);
      }
    }

    if (isProductStatus(status)) {
      listQuery = listQuery.eq("status", status);
    }
    if (categoryId) {
      listQuery = listQuery.eq("category_id", categoryId);
    }
    if (subCategoryId) {
      listQuery = listQuery.eq("sub_category_id", subCategoryId);
    }
    if (featured === "1" || featured === "0") {
      listQuery = listQuery.eq("is_featured", featured === "1");
    }
    if (minPrice !== "" && Number.isFinite(Number(minPrice))) {
      listQuery = listQuery.gte("price", Number(minPrice));
    }
    if (maxPrice !== "" && Number.isFinite(Number(maxPrice))) {
      listQuery = listQuery.lte("price", Number(maxPrice));
    }
    if (stockState === "out") {
      listQuery = listQuery.eq("stock", 0);
    } else if (stockState === "low") {
      listQuery = listQuery.gt("stock", 0).lte("stock", LOW_STOCK);
    } else if (stockState === "in") {
      listQuery = listQuery.gt("stock", 0);
    }

    // PostgREST answers a window that starts past the end of the result set with
    // 416 PGRST103 rather than with an empty array, and it does so only because
    // this query asks for an exact count: with `Prefer: count=exact` the server
    // refuses the unsatisfiable range instead of returning nothing. The request
    // did reach the table -- every filter above applied, there was simply
    // nothing on that page.
    //
    // That is an ordinary thing for a UI to ask for. A filter narrows the
    // catalogue while the admin sits on page 9, or the last row of the last page
    // is deleted, and either way the page number is now past the end. It is
    // answered as the empty page it means.
    //
    // Left as a 500 it read as "the product list is broken", in the one
    // situation where a reload could not help.
    const result = await listQuery.range(offset, offset + limit - 1);

    if (result.error && result.error.code !== "PGRST103") {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    let data = result.data;
    let count = result.count;

    if (result.error) {
      // The refused window carries no count, and the total is the one number the
      // UI needs in order to explain the empty page. Re-run over a window that
      // cannot be refused, purely to read the count, and discard its rows.
      const probe = await listQuery.range(0, 0);
      if (probe.error) {
        return NextResponse.json({ error: probe.error.message }, { status: 500 });
      }
      data = [];
      count = probe.count;
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
        // De-duplicated, and this is not cosmetic.
        //
        // Mapping over the variants yields a colour once per SIZE, so a product
        // with one colour and two sizes produced color_ids: [<colour>,
        // <colour>]. The form started from those ids and sent them back on
        // save, the server carried the duplicate into its cross product, and the
        // variant upsert tried to touch one row twice in a single statement:
        //
        //   ON CONFLICT DO UPDATE command cannot affect row a second time
        //
        // which reached the browser as a bare 500. admin_save_product now
        // de-duplicates as well, so the save is safe either way, but a form
        // seeded with a repeated id also renders that colour as selected twice
        // and cannot tell the two apart when one is toggled off.
        // Array.from rather than [...new Set(...)]: the spread form needs
        // downlevelIteration, and this file compiles to the ES5 target.
        color_ids: Array.from(new Set(variants.map((v) => v.color_id).filter((id): id is string => Boolean(id)))),
        size_ids: Array.from(new Set(variants.map((v) => v.size_id).filter((id): id is string => Boolean(id)))),
        promotion_ids: (promotion_products ?? []).map((p) => p.promotion_id),
      } as unknown as Product;
    });

    return NextResponse.json({
      data: products,
      // `total` is the count of everything that matched the filters, not the
      // size of this page, so the UI can say "showing 20 of 214" instead of
      // implying the twenty it loaded are all there are. The page count is
      // computed here rather than in the browser so both agree.
      pagination: {
        page,
        limit,
        total: count ?? 0,
        pages: Math.max(1, Math.ceil((count ?? 0) / limit)),
      },
      // Echoed so the table can label the sort it is actually receiving. The
      // route falls back to `newest` for an unknown key, and without this the
      // control would show a choice the query ignored.
      sort: SORTS[sortKey] ? sortKey : "newest",
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

    // badge and badge_type are derived now too, and this is where that decision
    // is enforced rather than merely intended.
    //
    // They used to be free text typed into the form next to the price, which
    // meant a product at its full price could be labelled "SALE" and a product
    // 40% under could carry no badge at all -- and no check anywhere compared
    // the two, because the badge was not connected to the discount. The server
    // now writes both from the discount on every save, so a badge in the
    // payload is a claim about the product that the price has not been asked
    // about. Dropping it here as well as in the function means a client cannot
    // reintroduce the field by posting one, and the function stays correct for
    // any caller rather than only this route.
    for (const derivedBadge of ["badge", "badge_type"]) {
      delete payload[derivedBadge];
    }

    // published_at and deleted_at belong to the database, not the form.
    // published_at is written once by the products_set_published_at trigger on
    // the transition into 'published', and deleted_at by
    // admin_soft_delete_product. Both columns are present on a row the form
    // loaded, so a plain round-trip of the edit payload would carry them back
    // — and a stale tab would then backdate a publication or un-retire a
    // product that someone else removed while the page was open. They are
    // dropped at the one place that knows the real contract.
    for (const serverOwned of ["published_at", "deleted_at"]) {
      delete payload[serverOwned];
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

/**
 * DELETE retires a product rather than removing it.
 *
 * It used to issue a real DELETE, which Postgres honoured across six
 * ON DELETE CASCADE foreign keys and took the authored product with it: the
 * size/colour matrix, the price overrides, the SKUs, the media and every
 * promotion link. order_items.product_id carries no foreign key, precisely so
 * that a past order keeps naming the product it was bought at — but
 * order_items.variant_id was left naming a variant the cascade had already
 * removed, so order history became unresolvable and could not be repaired
 * after the fact.
 *
 * The row is now marked retired through public.admin_soft_delete_product(),
 * which sets deleted_at and archives the product in one statement so the two
 * cannot disagree. The RLS DELETE policy has been withdrawn, so this function
 * is the only way a product leaves the table. The error mapping is shared with
 * the save path: named exceptions become HTTP status codes rather than a
 * 500 that looks like the product could not be found.
 */
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

    const { data, error } = await supabase.rpc("admin_soft_delete_product", {
      p_product_id: id,
    });

    if (error) {
      const described = describeAdminError(error);
      return NextResponse.json({ error: described.error, code: described.code }, { status: described.status });
    }

    return NextResponse.json({
      success: true,
      data: data as { id: string; slug: string; deleted_at: string },
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
