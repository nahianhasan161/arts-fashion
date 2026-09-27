import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { removeMediaObjects } from "@/lib/media/upload";
import { toAttachment, mediaErrorResponse } from "@/lib/media/mapping";

/**
 * /api/admin/media/attachments/[attachmentId]
 *
 *   PATCH   alt text, display name, folder
 *   DELETE  remove the file
 *
 * A staged file is referenced by no product and by no projection, so
 * deleting one cannot break a live page. That is why this needs no
 * equivalent of the in-use guard the product-image path has.
 */

type Params = { params: Promise<{ attachmentId: string }> };

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

    const { attachmentId } = await params;
    const body = await request.json();

    const { data: existing, error: readError } = await supabase
      .from("media_attachments")
      .select("*")
      .eq("id", attachmentId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "attachment_not_found" }, { status: 404 });
    }

    // Only the changed fields are written, so the caller does not have to
    // round-trip values it does not have loaded.
    const patch: Record<string, unknown> = {};
    if (body.alt_text !== undefined) {
      // An empty string means "no alt text", not "alt text that happens to
      // be blank". product_images already stores it as NULL, and the
      // missing-alt filter and the stats both read on that distinction, so
      // attachments normalise the same way instead of carrying a value
      // that looks described but is not.
      patch.alt_text = body.alt_text === null ? null : String(body.alt_text).trim() || null;
    }
    if (typeof body.file_name === "string" && body.file_name.trim()) {
      patch.file_name = body.file_name.trim().slice(0, 200);
    }
    if (body.folder_id === null) {
      patch.folder_id = null;
    } else if (typeof body.folder_id === "string" && body.folder_id) {
      patch.folder_id = body.folder_id;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ item: toAttachment(existing) });
    }

    const { data, error } = await supabase
      .from("media_attachments")
      .update(patch)
      .eq("id", attachmentId)
      .select("*")
      .single();

    if (error) return mediaErrorResponse(error.message);

    return NextResponse.json({ item: toAttachment(data) });
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

    const { attachmentId } = await params;

    // Row first, object second: a failure after this leaves an
    // unreferenced file rather than a row pointing at nothing.
    const { data, error } = await supabase.rpc("admin_delete_attachment", {
      p_attachment_id: attachmentId,
    });
    if (error) return mediaErrorResponse(error.message);

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
