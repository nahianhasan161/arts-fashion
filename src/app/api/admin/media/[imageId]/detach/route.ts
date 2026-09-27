import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { errorDetail } from "@/lib/media/mapping";

/**
 * /api/admin/media/[imageId]/detach
 *
 * Takes an image off its product and back into the staging area.
 *
 * This is the step that makes the library usable. The delete guard
 * refuses any file a product still references, and the sync trigger
 * guarantees every product image is referenced, so without detach the
 * library could list files but never remove one.
 *
 * The object is deliberately NOT moved. Relocating it would mean a bucket
 * rewrite for no gain: the path is only ever read as an opaque key, and
 * leaving it in place keeps the operation a single reversible row move.
 */

type Params = { params: Promise<{ imageId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
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
    const body = await request.json().catch(() => ({}));

    const { data, error } = await supabase.rpc("admin_detach_media", {
      p_image_id: imageId,
      p_folder_id: typeof body.folder_id === "string" && body.folder_id ? body.folder_id : null,
    });

    if (error) {
      const inUse = error.message.startsWith("media_in_use");
      return NextResponse.json(
        {
          error: error.message.split(":")[0],
          ...(inUse ? { detail: errorDetail(error.message) } : {}),
        },
        { status: inUse ? 409 : 400 }
      );
    }

    const result = (Array.isArray(data) ? data[0] : data) as
      | { storage_path?: string; product_id?: string }
      | null;

    return NextResponse.json({ success: true, ...(result ?? {}) });
  } catch (error) {
    return handleAdminError(error);
  }
}
