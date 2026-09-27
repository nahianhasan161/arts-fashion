import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resolveSizes } from "@/lib/sizes/chart";
import {
  DEFAULT_SIZE_REGION,
  type ResolvedSizeChart,
  type SizeLabel,
  type SizeMeasurement,
  type SizeRegion,
  type SizeRegionCode,
} from "@/types";

const VALID_REGIONS: SizeRegionCode[] = ["GLOBAL", "BD", "US"];

function isRegion(value: string | null): value is SizeRegionCode {
  return !!value && (VALID_REGIONS as string[]).includes(value);
}

/**
 * Public regional size chart. No admin auth: the storefront size guide needs it.
 *
 * GET /api/sizes?region=BD&category_id=<id>&sub_category_id=<id>&type=clothing
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const regionParam = url.searchParams.get("region");
    const categoryId = url.searchParams.get("category_id");
    const subCategoryId = url.searchParams.get("sub_category_id");
    const type = url.searchParams.get("type");
    const region: SizeRegionCode = isRegion(regionParam)
      ? regionParam
      : DEFAULT_SIZE_REGION;

    const [regionsRes, sizesRes] = await Promise.all([
      supabase.from("size_regions").select("*").order("display_order", { ascending: true }),
      supabase
        .from("sizes")
        .select("*")
        .eq("is_active", true)
        .order("sort_key", { ascending: true })
        .order("display_order", { ascending: true }),
    ]);

    if (regionsRes.error) {
      return NextResponse.json({ error: regionsRes.error.message }, { status: 500 });
    }
    if (sizesRes.error) {
      return NextResponse.json({ error: sizesRes.error.message }, { status: 500 });
    }

    const regions = (regionsRes.data ?? []) as SizeRegion[];
    let sizes = (sizesRes.data ?? []) as SizeLabel[];

    if (type) {
      sizes = sizes.filter((s) => s.type === type);
    }

    let measurements: SizeMeasurement[] = [];
    if (sizes.length > 0) {
      // Only rows for the requested region or the GLOBAL fallback are useful.
      const { data, error } = await supabase
        .from("size_measurements")
        .select("*")
        .in(
          "size_id",
          sizes.map((s) => s.id)
        )
        .in("region_code", [region, "GLOBAL"])
        .order("display_order", { ascending: true });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      measurements = (data ?? []) as SizeMeasurement[];
    }

    const resolved = resolveSizes({
      region,
      subCategoryId,
      categoryId,
      sizes,
      measurements,
      regions,
    });

    const meta = regions.find((r) => r.code === region);

    const chart: ResolvedSizeChart = {
      region: meta ?? {
        code: region,
        name: region,
        unit: "cm",
        label_style: "letter",
        display_order: 0,
      },
      sizes: resolved,
    };

    return NextResponse.json({ data: chart });
  } catch (error) {
    console.error("Unexpected size chart error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
