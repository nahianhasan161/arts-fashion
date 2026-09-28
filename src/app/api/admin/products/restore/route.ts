import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { describeAdminError } from "@/lib/admin/pg-error";

/**
 * Un-retires a product that was removed through DELETE /api/admin/products.
 *
 * Restore exists because 20260927130000 withdrew the RLS DELETE policy and
 * made soft delete the only way a product leaves the table. A removal that
 * cannot be undone is not a safety improvement, it is a different failure
 * mode: the rows, the matrix, the media and the promotion links are all
 * intact, so restoring is a flag change rather than a reconstruction, and
 * without this route that flag change would be unreachable from the app.
 *
 * It is POST rather than PUT because nothing about the product is being
 * replaced; the existing save route owns edits, and routing a restore
 * through it would be indistinguishable from a save that happened to clear a
 * field.
 *
 *   POST /api/admin/products/restore?id=<id>&status=draft|published|archived
 *
 * The status defaults to 'draft' in the function, deliberately. Restoring to
 * 'published' puts a product back on sale with no second decision, and a
 * product removed by mistake is not a product that should reappear on the
 * storefront the moment someone noticed.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const cookieStore = cookies();
    const supabase = await createSupabaseServerClient({
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

    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const status = url.searchParams.get("status") ?? "draft";

    if (!id) {
      return NextResponse.json({ error: "Product id is required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_restore_product", {
      p_product_id: id,
      p_status: status,
    });

    if (error) {
      const described = describeAdminError(error);
      return NextResponse.json({ error: described.error, code: described.code }, { status: described.status });
    }

    return NextResponse.json({
      success: true,
      data: data as { id: string; slug: string; status: string },
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
