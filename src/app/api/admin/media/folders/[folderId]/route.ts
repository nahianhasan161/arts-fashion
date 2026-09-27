import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { mediaErrorResponse } from "@/lib/media/mapping";

/**
 * /api/admin/media/folders/[folderId]
 *
 *   PATCH   rename or re-parent
 *   DELETE  remove the folder
 *
 * Deleting a folder does not delete files. The FK is ON DELETE SET NULL
 * for exactly that reason: files fall back to uncategorised instead of
 * disappearing with the folder.
 */

type Params = { params: Promise<{ folderId: string }> };

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

    const { folderId } = await params;
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "folder_name_required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_save_folder", {
      p_name: name,
      p_parent_id: body.parent_id || null,
      p_folder_id: folderId,
    });

    if (error) {
      if (/duplicate key|already exists/i.test(error.message)) {
        return NextResponse.json(
          { error: "folder_exists", detail: "A folder with that name already exists here" },
          { status: 409 }
        );
      }
      return mediaErrorResponse(error.message);
    }

    return NextResponse.json({ id: data, success: true });
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

    const { folderId } = await params;

    const { error } = await supabase.rpc("admin_delete_folder", {
      p_folder_id: folderId,
    });
    if (error) return mediaErrorResponse(error.message);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
