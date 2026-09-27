import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { GroupMember, UserGroupDetail } from "@/types";

/**
 * GET    /api/admin/user-groups/[groupId]  -> group + current members
 * PUT    /api/admin/user-groups/[groupId]  -> replace membership
 * DELETE /api/admin/user-groups/[groupId]  -> remove one member
 *
 * PUT replaces the whole membership set, resolved from emails and/or
 * profile ids. Sending an explicitly empty array clears the group; the
 * admin UI always sends the full list, and the RPC ignores a missing key
 * so a partial update cannot wipe membership by accident.
 */

type Params = { params: Promise<{ groupId: string }> };

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

    const { groupId } = await params;

    const { data: group, error } = await supabase
      .from("user_groups")
      .select("*")
      .eq("id", groupId)
      .single();

    if (error || !group) {
      return NextResponse.json({ error: "group_not_found" }, { status: 404 });
    }

    const { data: memberships, error: memberError } = await supabase
      .from("user_group_members")
      .select("user_id, assigned_at")
      .eq("group_id", groupId);

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    const ids = (memberships ?? []).map((m) => m.user_id);
    let profiles: { id: string; email: string | null; full_name: string | null }[] = [];
    if (ids.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      profiles = profileRows ?? [];
    }

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const assignedBy = new Map((memberships ?? []).map((m) => [m.user_id, m.assigned_at]));

    const members: GroupMember[] = ids
      .map((id) => ({
        user_id: id,
        email: byId.get(id)?.email ?? null,
        full_name: byId.get(id)?.full_name ?? null,
        assigned_at: assignedBy.get(id) ?? new Date().toISOString(),
      }))
      .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

    const detail: UserGroupDetail = {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description,
      is_active: group.is_active,
      created_at: group.created_at,
      updated_at: group.updated_at,
      members,
    };

    return NextResponse.json({ data: detail });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
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

    const { groupId } = await params;
    const body = await request.json();

    const emails = Array.isArray(body?.emails)
      ? body.emails.filter((e: unknown): e is string => typeof e === "string" && e.trim() !== "")
      : undefined;
    const userIds = Array.isArray(body?.user_ids)
      ? body.user_ids.filter((e: unknown): e is string => typeof e === "string" && e.trim() !== "")
      : undefined;

    if (emails === undefined && userIds === undefined) {
      return NextResponse.json(
        { error: "Send emails or user_ids to set membership" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("admin_set_group_members", {
      payload: {
        group_id: groupId,
        ...(emails !== undefined ? { emails } : {}),
        ...(userIds !== undefined ? { user_ids: userIds } : {}),
      },
    });

    if (error) {
      const map: Record<string, number> = {
        admin_required: 403,
        group_not_found: 404,
        no_members_supplied: 422,
      };
      return NextResponse.json({ error: error.message }, { status: map[error.message] ?? 400 });
    }

    return NextResponse.json({ success: true, data });
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

    const { groupId } = await params;
    const userId = new URL(_request.url).searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("user_group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
