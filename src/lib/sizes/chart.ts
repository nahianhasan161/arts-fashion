import type {
  ResolvedSize,
  SizeLabel,
  SizeMeasurement,
  SizeRegion,
  SizeRegionCode,
} from "@/types";

/** Key a measurement row by size + region + category scope ("_" = all categories). */
function key(sizeId: string, region: string, categoryId: string | null): string {
  return `${sizeId}|${region}|${categoryId ?? "_"}`;
}

export interface ResolveOptions {
  /** The region the shopper asked for. */
  region: SizeRegionCode;
  /** Optional narrower scope, preferred over categoryId when present. */
  subCategoryId?: string | null;
  categoryId?: string | null;
  sizes: SizeLabel[];
  measurements: SizeMeasurement[];
  /** Region metadata, used to supply unit + label_style. */
  regions: SizeRegion[];
}

/**
 * Pick the most specific regional chart row for a size.
 *
 * Order of preference:
 *   1. region + subcategory   2. region + category   3. region (all categories)
 *   4. GLOBAL + subcategory   5. GLOBAL + category   6. GLOBAL (all categories)
 *
 * The canonical `size_id` is the identity that survives all of this: a shopper
 * seeing a BD "40" and a US "M" resolve to the same size_id, so stock decrements
 * once. Only the presentation changes.
 */
export function resolveSizes({
  region,
  subCategoryId,
  categoryId,
  sizes,
  measurements,
  regions,
}: ResolveOptions): ResolvedSize[] {
  const index = new Map<string, SizeMeasurement>();
  for (const m of measurements) {
    index.set(key(m.size_id, m.region_code, m.category_id), m);
  }

  const regionMeta = new Map<string, SizeRegion>();
  for (const r of regions) {
    regionMeta.set(r.code, r);
  }

  const ordered = [...sizes].sort(
    (a, b) => a.sort_key - b.sort_key || a.display_order - b.display_order
  );

  return ordered.map((size) => {
    // Build the scope list once, most specific first. A scope is only
    // included when it was actually supplied, otherwise the null-category
    // entry would appear first and short-circuit the category-specific row.
    const scopes: Array<string | null> = [];
    if (subCategoryId) scopes.push(subCategoryId);
    if (categoryId && categoryId !== subCategoryId) scopes.push(categoryId);
    scopes.push(null);

    const chain: Array<{ region: string; categoryId: string | null }> = [
      ...scopes.map((categoryId) => ({ region, categoryId })),
      ...scopes.map((categoryId) => ({ region: "GLOBAL", categoryId })),
    ];

    let match: SizeMeasurement | undefined;
    for (const candidate of chain) {
      const found = index.get(key(size.id, candidate.region, candidate.categoryId));
      if (found) {
        match = found;
        break;
      }
    }

    const usedRegion = match?.region_code ?? region;
    const meta = regionMeta.get(usedRegion) ?? regionMeta.get(region);

    // A row scoped to a category is more specific than a region-wide row.
    // Anything reached via GLOBAL is a fallback, not a real match.
    let matchedScope: ResolvedSize["matched_scope"] = "fallback";
    if (match) {
      if (match.region_code === "GLOBAL") {
        matchedScope = "fallback";
      } else {
        matchedScope = match.category_id ? "category" : "region";
      }
    }

    return {
      size_id: size.id,
      canonical_label: size.display_name || size.name,
      label: match?.label_override || size.display_name || size.name,
      region_code: (match?.region_code ?? region) as SizeRegionCode,
      unit: meta?.unit ?? "cm",
      label_style: meta?.label_style ?? "letter",
      measurements: match?.measurements ?? {},
      display_order: match?.display_order ?? size.display_order,
      matched_scope: matchedScope,
    };
  });
}
