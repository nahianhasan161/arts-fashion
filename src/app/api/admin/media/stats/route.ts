import { NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";

/** /api/admin/media/stats -- storage analytics, aggregate only. */
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

    const { data, error } = await supabase.rpc("admin_media_stats");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      (Array.isArray(data) ? data[0] : data) ?? {},
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return handleAdminError(error);
  }
}
