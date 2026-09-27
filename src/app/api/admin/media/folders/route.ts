import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import { mediaErrorResponse, toAttachment } from "@/lib/media/mapping";

/**
 * /api/admin/media/folders
 *
 *   GET   the folder tree, plus the staged files awaiting attachment
 *   POST  create a folder
 *   PATCH create, update or delete an attachment
 *
 * Folders are organisational only. Moving a file between them never
 * touches the bucket, so reorganising the library cannot invalidate a
 * URL that a live product page is already using.
 */

export async function GET() {
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

    const [{ data: folders, error: folderError }, { data: staged, error: stagedError }] =
      await Promise.all([
        supabase.from("media_folders").select("*").order("name", { ascending: true }),
        supabase
          .from("media_attachments")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

    if (folderError) {
      return NextResponse.json({ error: folderError.message }, { status: 500 });
    }
    if (stagedError) {
      return NextResponse.json({ error: stagedError.message }, { status: 500 });
    }

    return NextResponse.json({
      folders: (folders ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        parent_id: f.parent_id ?? null,
      })),
      // Attachments are staged files with no product yet. They are listed
      // separately from product_images because they are the only files
      // that can be deleted outright.
      staged: (staged ?? []).map(toAttachment),
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

  try {
    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "folder_name_required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_save_folder", {
      p_name: name,
      p_parent_id: body.parent_id || null,
      p_folder_id: null,
    });

    if (error) {
      // The unique index on (parent, name) raises as a plain violation,
      // so it is translated into the same word the rest of the API uses.
      if (/duplicate key|already exists/i.test(error.message)) {
        return NextResponse.json(
          { error: "folder_exists", detail: "A folder with that name already exists here" },
          { status: 409 }
        );
      }
      return mediaErrorResponse(error.message);
    }

    return NextResponse.json({ id: data, success: true }, { status: 201 });
  } catch (error) {
    return handleAdminError(error);
  }
}
