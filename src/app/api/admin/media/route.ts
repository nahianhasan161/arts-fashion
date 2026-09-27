import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { uploadMediaFile, removeMediaObjects, publicUrlFor } from "@/lib/media/upload";
import { mediaErrorResponse } from "@/lib/media/mapping";

/**
 * /api/admin/media
 *
 *   GET   browse the library: search, filter, sort, paginate
 *   POST  upload into the staging area, or straight onto a product
 *
 * The library is a view over product_images plus the unattached
 * staging area, so there is no media table to keep in step: one row
 * describes a file and its product association cannot disagree with
 * anything else.
 */

/**
 * Query values arrive as strings, and a missing one arrives as null.
 * `Number(null)` is 0, not NaN, so a bare Number() check would silently
 * turn "no limit given" into "limit of zero" and the library would come
 * back with a single row. Absent and unparseable are both "use the
 * default", so both are handled explicitly.
 */
const num = (v: string | null, fallback: number) => {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | null) => v === "true" || v === "1";

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

    const p = request.nextUrl.searchParams;
    const { data, error } = await supabase.rpc("admin_media_list", {
      p_search: p.get("search") || null,
      p_mime: p.get("mime") || null,
      p_folder_id: p.get("folder") || null,
      p_missing_alt: bool(p.get("missing_alt")),
      p_only_unused: bool(p.get("only_unused")),
      p_sort: p.get("sort") || "newest",
      p_limit: num(p.get("limit"), 60),
      p_offset: num(p.get("offset"), 0),
    });

    if (error) return mediaErrorResponse(error.message);

    const result = (Array.isArray(data) ? data[0] : data) as {
      items?: Record<string, unknown>[];
      total?: number;
      limit?: number;
      offset?: number;
    } | null;

    return NextResponse.json({
      items: result?.items ?? [],
      total: result?.total ?? 0,
      limit: result?.limit ?? 60,
      offset: result?.offset ?? 0,
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

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "No files supplied" }, { status: 400 });
    }
    if (files.length > 20) {
      return NextResponse.json(
        { error: "At most 20 files per upload" },
        { status: 400 }
      );
    }

    // productId sends the file straight to a product; otherwise it lands in
    // the staging area, where it waits until someone attaches it.
    const productId = String(form.get("productId") ?? "").trim();
    const altText = String(form.get("alt_text") ?? "").trim();
    const folderId = String(form.get("folder_id") ?? "").trim() || null;

    if (productId) {
      const { data: product } = await supabase
        .from("products")
        .select("id")
        .eq("id", productId)
        .maybeSingle();
      if (!product) {
        return NextResponse.json({ error: "product_not_found" }, { status: 404 });
      }
    }

    // The staging prefix sits outside every product folder, so an
    // attachment can never be mistaken for a path the product rule allows.
    const prefix = productId || "unattached";

    const uploaded: Record<string, unknown>[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const file of files) {
      const out = await uploadMediaFile(supabase, file, prefix);

      if (!out.ok) {
        failed.push({ name: out.name, reason: out.reason });
        continue;
      }

      const { asset } = out;

      if (productId) {
        // Record the row, then the metadata. Two steps so a file that
        // uploads but fails to record still leaves a visible row.
        const { data: imageId, error: recordError } = await supabase.rpc(
          "admin_add_product_image",
          {
            p_product_id: productId,
            p_storage_path: asset.storage_path,
            p_alt_text: altText,
            p_is_primary: false,
          }
        );

        if (recordError) {
          // The object exists with no row, so it would never be listed and
          // never deleted. Take it back out before reporting the failure.
          await removeMediaObjects(supabase, [asset.storage_path]);
          failed.push({ name: asset.file_name, reason: recordError.message });
          continue;
        }

        const { error: metaError } = await supabase.rpc(
          "admin_record_media_metadata",
          {
            p_image_id: imageId,
            p_file_name: asset.file_name,
            p_mime_type: asset.mime_type,
            p_byte_size: asset.byte_size,
            p_width: null,
            p_height: null,
          }
        );
        if (metaError) {
          // The row is already there, so the file is usable. Metadata is
          // what the analytics panel reads, so it is reported rather than
          // discarding a good upload.
          failed.push({ name: asset.file_name, reason: metaError.message });
        }
        // Counted like a staged upload. Reporting zero here would tell the
        // admin their file was rejected when in fact it is already on the
        // product, which is the more damaging of the two mistakes.
        uploaded.push({
          id: String(imageId),
          storage_path: asset.storage_path,
          url: publicUrlFor(asset.storage_path),
          file_name: asset.file_name,
          mime_type: asset.mime_type,
          byte_size: asset.byte_size,
          product_id: productId,
          unattached: false,
        });
        continue;
      }

      const { data: attachmentId, error: attachError } = await supabase
        .from("media_attachments")
        .insert({
          storage_path: asset.storage_path,
          file_name: asset.file_name,
          mime_type: asset.mime_type,
          byte_size: asset.byte_size,
          alt_text: altText || null,
          folder_id: folderId,
        })
        .select("id")
        .single();

      if (attachError) {
        await removeMediaObjects(supabase, [asset.storage_path]);
        failed.push({ name: asset.file_name, reason: attachError.message });
        continue;
      }

      uploaded.push({
        id: (attachmentId as { id: string }).id,
        storage_path: asset.storage_path,
        url: publicUrlFor(asset.storage_path),
        file_name: asset.file_name,
        mime_type: asset.mime_type,
        byte_size: asset.byte_size,
        unattached: true,
      });
    }

    return NextResponse.json({
      uploaded: uploaded.length,
      items: uploaded,
      failed,
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
