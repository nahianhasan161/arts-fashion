import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { SizeLabel, SizeLabelWithMeasurements, SizeMeasurement } from "@/types";

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

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const includeMeasurements = url.searchParams.get("include_measurements") === "true";
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100", 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));

    let query = supabase
      .from("sizes")
      .select("*", { count: "exact" })
      .order("sort_key", { ascending: true })
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (type) {
      query = query.eq("type", type);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const sizes = (data ?? []) as SizeLabel[];

    // Fetch every regional row for the returned sizes in one query
    if (includeMeasurements && sizes.length > 0) {
      const { data: measurementData, error: measurementError } = await supabase
        .from("size_measurements")
        .select("*")
        .in(
          "size_id",
          sizes.map((s) => s.id)
        )
        .order("display_order", { ascending: true });

      if (measurementError) {
        return NextResponse.json({ error: measurementError.message }, { status: 500 });
      }

      const bySize = new Map<string, SizeMeasurement[]>();
      for (const row of (measurementData ?? []) as SizeMeasurement[]) {
        const list = bySize.get(row.size_id) ?? [];
        list.push(row);
        bySize.set(row.size_id, list);
      }

      const nested: SizeLabelWithMeasurements[] = sizes.map((s) => ({
        ...s,
        measurements: bySize.get(s.id) ?? [],
      }));

      return NextResponse.json({
        data: nested,
        pagination: { page: Math.floor(offset / limit) + 1, limit, total: count ?? 0 },
      });
    }

    return NextResponse.json({
      data: sizes,
      pagination: { page: Math.floor(offset / limit) + 1, limit, total: count ?? 0 },
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
    const { name, display_name, type, fit_type, sort_key, is_active } = body;

    if (!name) {
      return NextResponse.json({ error: "Size name is required" }, { status: 400 });
    }

    const { error } = await supabase.from("sizes").insert([{
      id: crypto.randomUUID(),
      name,
      display_name: display_name ?? name,
      type: type ?? "clothing",
      fit_type: fit_type ?? "standard",
      sort_key: sort_key ?? 0,
      is_active: is_active ?? true,
      display_order: 0,
    }]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PUT(request: NextRequest) {
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
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Size id is required" }, { status: 400 });
    }

    // Only allow known columns to be written
    const allowed = ["name", "display_name", "type", "fit_type", "sort_key", "is_active", "display_order"];
    const sanitized: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in updates) sanitized[key] = updates[key];
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { error } = await supabase
      .from("sizes")
      .update({ ...sanitized, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function DELETE(request: NextRequest) {
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

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Size id is required" }, { status: 400 });
    }

    // size_measurements has ON DELETE CASCADE, so regional rows go with it.
    const { error } = await supabase.from("sizes").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
