import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";
import { getAdminSupabase } from "@/lib/admin/supabase";
import type { SizeMeasurement, SizeRegionCode } from "@/types";

const VALID_REGIONS: SizeRegionCode[] = ["GLOBAL", "BD", "US"];

type Context = { params: { sizeId: string } };

/** Coerce arbitrary measurement input into { key: number }, dropping junk. */
function sanitizeMeasurements(input: unknown): Record<string, number> | null {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(num)) {
      out[key.trim().toLowerCase()] = num;
    }
  }
  return out;
}

export async function GET(request: NextRequest, { params }: Context) {
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
    const region = url.searchParams.get("region");
    const categoryId = url.searchParams.get("category_id");

    let query = supabase
      .from("size_measurements")
      .select("*")
      .eq("size_id", params.sizeId)
      .order("display_order", { ascending: true });

    if (region) {
      query = query.eq("region_code", region);
    }
    if (categoryId) {
      query = query.eq("category_id", categoryId);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: (data ?? []) as SizeMeasurement[] });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function POST(request: NextRequest, { params }: Context) {
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
    const { region_code, category_id, label_override, measurements } = body;

    if (!region_code || !VALID_REGIONS.includes(region_code)) {
      return NextResponse.json(
        { error: `region_code must be one of ${VALID_REGIONS.join(", ")}` },
        { status: 400 }
      );
    }

    const sanitized = sanitizeMeasurements(measurements);
    if (sanitized === null) {
      return NextResponse.json(
        { error: "measurements must be an object of numeric values" },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("size_measurements").insert([{
      id: crypto.randomUUID(),
      size_id: params.sizeId,
      region_code,
      category_id: category_id || null,
      label_override: label_override || null,
      measurements: sanitized,
      display_order: 0,
    }]);

    if (error) {
      // Partial unique indexes surface as 23505 on a duplicate scope.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This size already has a chart entry for that region and category scope" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function PUT(request: NextRequest, { params }: Context) {
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
    const { id, region_code, category_id, label_override, measurements, display_order } = body;

    if (!id) {
      return NextResponse.json({ error: "Measurement id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (region_code !== undefined) {
      if (!VALID_REGIONS.includes(region_code)) {
        return NextResponse.json(
          { error: `region_code must be one of ${VALID_REGIONS.join(", ")}` },
          { status: 400 }
        );
      }
      updates.region_code = region_code;
    }
    if (category_id !== undefined) {
      updates.category_id = category_id || null;
    }
    if (label_override !== undefined) {
      updates.label_override = label_override || null;
    }
    if (display_order !== undefined) {
      updates.display_order = display_order;
    }
    if (measurements !== undefined) {
      const sanitized = sanitizeMeasurements(measurements);
      if (sanitized === null) {
        return NextResponse.json(
          { error: "measurements must be an object of numeric values" },
          { status: 400 }
        );
      }
      updates.measurements = sanitized;
    }

    const { error } = await supabase
      .from("size_measurements")
      .update(updates)
      .eq("id", id)
      .eq("size_id", params.sizeId);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This size already has a chart entry for that region and category scope" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
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
      return NextResponse.json({ error: "Measurement id is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("size_measurements")
      .delete()
      .eq("id", id)
      .eq("size_id", params.sizeId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleAdminError(error);
  }
}
