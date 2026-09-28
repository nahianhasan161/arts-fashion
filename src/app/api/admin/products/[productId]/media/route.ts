import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { uploadMediaFile, removeMediaObjects, publicUrlFor } from "@/lib/media/upload";
import type { ProductImage } from "@/types";

/**
 * /api/admin/products/[productId]/media
 *
 *   GET     list the product's images, primary first
 *   POST    upload one or more files (multipart/form-data)
 *   PATCH   update alt text / set primary / reorder
 *   DELETE  remove one image, or every image for the product
 *
 * The upload itself is delegated to the shared helper, so the product
 * editor and the media library store files identically. The product
 * prefix is enforced in SQL, so a row can never point at another
 * product's file, and the uuid means a filename collision can never
 * overwrite an existing image.
 *
 * Storage and database are two systems, so a partial failure is
 * possible. The order is upload-then-record, and if recording fails the
 * uploaded object is removed again, so a rejected upload leaves neither
 * a file nor a row behind.
 */

const MAX_FILES_PER_REQUEST = 10;
type Params = { params: Promise<{ productId: string }> };

/** Map the RPC's snake_case messages onto HTTP statuses. */
function mediaErrorResponse(message: string): NextResponse {
  const map: Record<string, number> = {
    admin_required: 403,
    product_not_found: 404,
    image_not_found: 404,
    storage_path_required: 400,
    invalid_storage_path: 400,
    image_limit_reached: 409,
  };
  return NextResponse.json({ error: message }, { status: map[message] ?? 400 });
}

/** Rows from the table plus the public URL for the stored object. */
function toImage(row: Record<string, unknown>): ProductImage {
  const path = String(row.storage_path ?? "");
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    storage_path: path,
    url: publicUrlFor(path),
    alt_text: (row.alt_text as string | null) ?? null,
    sort_order: Number(row.sort_order ?? 0),
    is_primary: Boolean(row.is_primary),
  };
}

export async function GET(_request: NextRequest, { params }: Params) {
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
    const { productId } = await params;

    const { data, error } = await supabase
      .from("product_images")
      .select("*")
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: (data ?? []).map((r) => toImage(r)) });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  try {
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }
    const { productId } = await params;

    // Fail before uploading anything if the product does not exist.
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id")
      .eq("id", productId)
      .maybeSingle();

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 });
    }
    if (!product) {
      return NextResponse.json({ error: "product_not_found" }, { status: 404 });
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const makePrimary = form.get("is_primary") === "true";
    const altText = String(form.get("alt_text") ?? "").trim();

    if (files.length === 0) {
      return NextResponse.json({ error: "No files supplied" }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `At most ${MAX_FILES_PER_REQUEST} files per upload` },
        { status: 400 }
      );
    }

    const uploaded: ProductImage[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const file of files) {
      // Size, magic bytes and path generation all live in the shared
      // helper, so an image accepted by the product editor is accepted by
      // the library under identical rules.
      const outcome = await uploadMediaFile(supabase, file, productId);

      if (!outcome.ok) {
        failed.push({ name: outcome.name, reason: outcome.reason });
        continue;
      }

      const { asset } = outcome;

      const { data: imageId, error: recordError } = await supabase.rpc(
        "admin_add_product_image",
        {
          p_product_id: productId,
          p_storage_path: asset.storage_path,
          p_alt_text: altText,
          p_is_primary: makePrimary,
        }
      );

      if (recordError) {
        // The file exists but has no row, so it would never be listed or
        // ever deleted. Remove it before reporting the failure.
        await removeMediaObjects(supabase, [asset.storage_path]);
        failed.push({ name: asset.file_name, reason: recordError.message });
        continue;
      }

      // The row exists at this point, so a metadata failure is reported
      // but not fatal: the file is visible and deletable in the library
      // even without its type and size recorded.
      const { error: metaError } = await supabase.rpc("admin_record_media_metadata", {
        p_image_id: String(imageId),
        p_file_name: asset.file_name,
        p_mime_type: asset.mime_type,
        p_byte_size: asset.byte_size,
        p_width: null,
        p_height: null,
      });

      if (metaError) {
        failed.push({
          name: asset.file_name,
          reason: `Uploaded, but its details could not be recorded: ${metaError.message}`,
        });
      }

      uploaded.push({
        id: String(imageId),
        product_id: productId,
        storage_path: asset.storage_path,
        url: publicUrlFor(asset.storage_path),
        alt_text: altText || null,
        sort_order: uploaded.length,
        is_primary: makePrimary && uploaded.length === 0,
      });
    }

    // Report the authoritative state rather than the optimistic rows
    // built above, so the client renders exactly what the trigger wrote.
    const { data: rows } = await supabase
      .from("product_images")
      .select("*")
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    return NextResponse.json({
      data: (rows ?? []).map((r) => toImage(r)),
      uploaded: uploaded.length,
      failed,
    });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
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
    const { productId } = await params;
    const body = await request.json();

    // Reorder: one RPC, so the projection is never partially applied.
    if (Array.isArray(body?.image_ids)) {
      const { error } = await supabase.rpc("admin_reorder_product_images", {
        p_product_id: productId,
        p_image_ids: body.image_ids,
      });
      if (error) return mediaErrorResponse(error.message);
    }

    // Set primary. Its own RPC because promoting must demote the
    // incumbent atomically.
    if (typeof body?.set_primary === "string") {
      const { error } = await supabase.rpc("admin_set_primary_product_image", {
        p_image_id: body.set_primary,
      });
      if (error) return mediaErrorResponse(error.message);
    }

    // Metadata edit: alt text only.
    if (typeof body?.image_id === "string" && body?.alt_text !== undefined) {
      // The RPC reads NULL as "leave this field alone", so that a caller
      // can change one field without resending the others. That makes it
      // impossible to clear alt text by sending null, so a null here means
      // "clear" and is sent as an empty string, which the RPC normalises
      // back to NULL.
      const { error } = await supabase.rpc("admin_update_product_image", {
        p_image_id: body.image_id,
        p_alt_text: body.alt_text === null ? "" : String(body.alt_text),
      });
      if (error) return mediaErrorResponse(error.message);
    }

    const { data, error } = await supabase
      .from("product_images")
      .select("*")
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: (data ?? []).map((r) => toImage(r)) });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
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
    const { productId } = await params;
    const url = new URL(request.url);
    const imageId = url.searchParams.get("image_id");
    const all = url.searchParams.get("all") === "true";

    if (!imageId && !all) {
      return NextResponse.json(
        { error: "image_id or all=true is required" },
        { status: 400 }
      );
    }

    // Collect the paths first, because the RPC returns the path of a
    // deleted row and the object has to be removed from the bucket after.
    let paths: string[] = [];

    if (all) {
      const { data } = await supabase
        .from("product_images")
        .select("storage_path")
        .eq("product_id", productId);
      paths = (data ?? []).map((r) => r.storage_path as string);
    } else {
      const { data, error } = await supabase.rpc("admin_delete_product_image", {
        p_image_id: imageId,
      });
      if (error) return mediaErrorResponse(error.message);
      if (data?.storage_path) paths = [data.storage_path as string];
    }

    if (all) {
      const { error } = await supabase
        .from("product_images")
        .delete()
        .eq("product_id", productId);
      if (error) return mediaErrorResponse(error.message);
    }

    // The row is authoritative and already gone, so failing to remove the
    // object leaves an unreferenced file, not a broken product. Report
    // it instead of pretending the whole delete failed.
    let storageError: string | null = null;
    if (paths.length > 0) {
      storageError = await removeMediaObjects(supabase, paths);
    }

    return NextResponse.json({
      success: true,
      removed: paths.length,
      ...(storageError ? { storage_warning: storageError } : {}),
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
