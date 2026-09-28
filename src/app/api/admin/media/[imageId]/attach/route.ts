import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { moveMediaObject, removeMediaObjects, publicUrlFor } from "@/lib/media/upload";
import { mediaErrorResponse } from "@/lib/media/mapping";

/**
 * /api/admin/media/[imageId]/attach
 *
 * Moves a staged file onto a product.
 *
 * The object has to be relocated into the product's folder, because
 * admin_attach_media enforces the same single-segment path rule the
 * product editor does, and SQL cannot move a bucket object. So the
 * sequence is: copy to the new path, record the new path, drop the old
 * object. Doing it in that order means a failure leaves the file still
 * reachable from the staging row.
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
    const body = await request.json();
    const productId = String(body.product_id ?? "").trim();

    if (!productId) {
      return NextResponse.json({ error: "product_id is required" }, { status: 400 });
    }

    const { data: row, error: readError } = await supabase
      .from("media_attachments")
      .select("*")
      .eq("id", imageId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "attachment_not_found" }, { status: 404 });
    }

    // The extension has to be carried across, because the path rule allows
    // exactly one more segment under the product id.
    const ext = String(row.storage_path).split(".").pop() ?? "png";
    const oldPath = String(row.storage_path);
    const newPath = `${productId}/${crypto.randomUUID()}.${ext}`;

    const moveError = await moveMediaObject(supabase, oldPath, newPath);

    if (moveError) {
      return NextResponse.json({ error: moveError }, { status: 500 });
    }

    // admin_attach_media re-validates the row's own storage_path against
    // the product prefix, because it cannot trust a path it did not
    // resolve. The row therefore has to carry the new path before the RPC
    // runs; leaving it on the staging path makes every attach fail with
    // invalid_storage_path.
    //
    // Both objects exist at this point, so the row is describing a file
    // that is really there whichever prefix it names. If the RPC then
    // refuses, the row is put back and the copied object removed, which
    // restores exactly the starting state.
    const { error: repathError } = await supabase
      .from("media_attachments")
      .update({ storage_path: newPath })
      .eq("id", imageId);

    if (repathError) {
      await removeMediaObjects(supabase, [newPath]);
      return NextResponse.json({ error: repathError.message }, { status: 500 });
    }

    const { data: recordedPath, error: attachError } = await supabase.rpc(
      "admin_attach_media",
      {
        p_attachment_id: imageId,
        p_product_id: productId,
        p_alt_text: body.alt_text === undefined ? null : body.alt_text,
        p_is_primary: body.is_primary === true,
      }
    );

    if (attachError) {
      // The row points somewhere unreferenced again, and the original
      // object is still in the bucket, so put the path back and drop the
      // copy. The staging row is then exactly as it was.
      await supabase.from("media_attachments").update({ storage_path: oldPath }).eq("id", imageId);
      await removeMediaObjects(supabase, [newPath]);
      return mediaErrorResponse(attachError.message);
    }

    // Only now is the old object unreferenced.
    await removeMediaObjects(supabase, [oldPath]);

    return NextResponse.json({
      success: true,
      storage_path: recordedPath ?? newPath,
      url: publicUrlFor(String(recordedPath ?? newPath)),
    });
  } catch (error) {
    return handleAdminError(error);
  }
}
