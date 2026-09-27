import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { removeMediaObjects } from "@/lib/media/upload";
import { mediaErrorResponse, errorDetail } from "@/lib/media/mapping";

/**
 * /api/admin/media/[imageId]
 *
 *   PATCH   alt text, display name, folder
 *   DELETE  remove the file
 *
 * DELETE refuses any image a product still references, because
 * products.images holds its URL as plain jsonb that no foreign key
 * protects, and a dangling entry there is a broken image on a live
 * storefront. The UI offers Detach first, which moves the file to the
 * staging area where it is genuinely unreferenced and can be removed.
 */

type Params = { params: Promise<{ imageId: string }> };

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

    const { imageId } = await params;
    const body = await request.json();

    // Only send what the admin actually changed. The RPC treats NULL as
    // "leave alone", and an empty string as "clear", which is what makes
    // clearing alt text possible.
    const { data, error } = await supabase.rpc("admin_update_media", {
      p_image_id: imageId,
      p_alt_text: body.alt_text === undefined ? null : body.alt_text === null ? "" : String(body.alt_text),
      p_file_name: typeof body.file_name === "string" ? body.file_name : null,
      p_folder_id: typeof body.folder_id === "string" && body.folder_id ? body.folder_id : null,
      p_clear_folder: body.folder_id === null,
    });

    if (error) return mediaErrorResponse(error.message);

    const item = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    return NextResponse.json({ item });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
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

    const { imageId } = await params;

    // The row goes first. If the object removal then fails, the result is
    // an unreferenced file, which is recoverable, rather than a row
    // pointing at nothing, which is a broken image.
    const { data, error } = await supabase.rpc("admin_delete_media", {
      p_image_id: imageId,
    });

    if (error) {
      // The shared mapping already turns image_not_found into a 404 and
      // media_in_use into a 409. Only the in-use case carries extra
      // guidance, because it is the one where the admin has a next step.
      if (error.message.startsWith("media_in_use")) {
        return NextResponse.json(
          {
            error: "media_in_use",
            detail: errorDetail(error.message),
            hint: "Detach the image from its product first, then delete it.",
          },
          { status: 409 }
        );
      }
      return mediaErrorResponse(error.message);
    }

    const result = (Array.isArray(data) ? data[0] : data) as
      | { storage_path?: string }
      | null;

    const storageWarning = await removeMediaObjects(
      supabase,
      result?.storage_path ? [result.storage_path] : []
    );

    return NextResponse.json({
      success: true,
      removed: 1,
      ...(storageWarning ? { storage_warning: storageWarning } : {}),
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
