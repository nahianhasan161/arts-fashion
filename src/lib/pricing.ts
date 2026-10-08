/**
 * Pricing arithmetic, in one place, mirroring the database.
 *
 * This exists because the same three numbers -- a base price, a discount type
 * and a discount value -- are computed in three separate places: the server
 * function `calculate_sale_price`, the discount preview in the product form,
 * and the badge text the storefront renders. They used to disagree, and the
 * disagreement was invisible because each looked correct on its own: the form
 * previewed a price to the paisa that the server then stored a paisa away from,
 * and a 14.8% markdown produced the badge "14.8% OFF" beside a price that is
 * really 15% off.
 *
 * Everything here is display and preview arithmetic. None of it is ever sent to
 * the server as an authority: `price`, `original_price` and `discount_percent`
 * remain derived by `admin_save_product`, and a client-computed value in the
 * payload is exactly what the server-authoritative design exists to prevent.
 * If these and the SQL ever diverge, the SQL is right and this file is the bug.
 *
 * The SQL to keep in step with is `public.calculate_sale_price` and the money
 * block of `public.admin_save_product`.
 */

export type DiscountType = "percentage" | "flat";

/**
 * How an admin chose to express the discount.
 *
 * The mode is a statement about the authoring, not about the price: all four
 * collapse to the same stored triple (regular_price, discount_type,
 * discount_value). That is the whole reason a fourth mode can be added to the
 * form without a migration, a new column, or a second pricing path for the
 * storefront to understand.
 */
export type DiscountMode = "none" | "comparison" | "custom" | "promotion";

export const DISCOUNT_MODES: readonly DiscountMode[] = [
  "none",
  "comparison",
  "custom",
  "promotion",
];

export const DISCOUNT_MODE_LABELS: Record<DiscountMode, string> = {
  none: "No discount",
  comparison: "Price comparison",
  custom: "Custom discount",
  promotion: "Promotion",
};

/** Half-up to a paisa, the way Postgres `ROUND(x, 2)` rounds. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Money, always two decimals, grouped the way every other surface groups it. */
export function formatTaka(value: number): string {
  return `৳ ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A percentage for display: rounded to a whole number.
 *
 * "14.8% OFF" is precise and unreadable, and the precision is not even real --
 * the price is stored to the paisa, so the true saving is 15% to the precision a
 * shopper can act on. This is the rounding the badge and every percentage label
 * goes through, so 14.8 and 15.0 cannot appear as two different discounts for
 * the same markdown.
 *
 * Never applied to a stored value: `discount_value` keeps its 2 decimals, so
 * changing this does not change what a product costs.
 */
export function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * The price a shopper pays.
 *
 * Mirrors `public.calculate_sale_price` including its rounding and its clamp at
 * zero, not just its arithmetic. Previewing an unrounded number is how a form
 * comes to show 849.99 and then save 850.00.
 */
export function salePrice(regular: number, type: DiscountType, value: number): number {
  if (!Number.isFinite(regular)) return 0;
  if (type === "percentage") {
    return Math.max(round2(regular * (1 - (value || 0) / 100)), 0);
  }
  if (type === "flat") {
    return Math.max(round2(regular - (value || 0)), 0);
  }
  return round2(regular);
}

/**
 * The markdown a base price and a sale price represent, as a percentage.
 *
 * Used by price-comparison mode, where the admin enters two prices and the
 * percentage is a consequence rather than an input. Rounded to two decimals
 * because `products.discount_value` is NUMERIC(10,2) and a third decimal would
 * be silently truncated on save, leaving a badge that does not describe the
 * stored number.
 */
export function percentBetween(oldPrice: number, newPrice: number): number {
  if (!(oldPrice > 0)) return 0;
  return round2(((oldPrice - newPrice) / oldPrice) * 100);
}

/**
 * The badge text a discount produces, or null when there is no discount.
 *
 * The single definition of the wording, shared by the product form's live badge
 * preview, the server-side badge it writes, and the storefront. A discount of
 * zero produces no badge rather than "0% OFF", which is a badge that says
 * nothing while occupying the corner of the product image.
 */
export function discountBadgeLabel(type: DiscountType, value: number): string | null {
  if (!(value > 0)) return null;
  if (type === "percentage") {
    return `${roundPercent(value)}% OFF`;
  }
  // Trailing zeros are dropped from a flat amount the way `fmt_num` drops them,
  // so 150 reads as "150 OFF" and 150.50 as "150.5 OFF". String() on an
  // already-rounded number does exactly the stripping fmt_num does, without
  // carrying a second copy of that regexp to the client.
  return `${round2(value)} OFF`;
}

/** Everything the discount UI needs to describe one markdown, in one shape. */
export interface DerivedDiscount {
  /** What the shopper pays. */
  sale: number;
  /** The markdown as a rounded whole-number percentage, 0 when there is none. */
  percent: number;
  /** The badge the storefront will show for this markdown, or null. */
  badgeLabel: string | null;
  /** True when the markdown actually lowers the price. */
  hasDiscount: boolean;
}

/**
 * Derives the display figures for a stored markdown.
 *
 * Takes the base price rather than assuming one, because the percentage a flat
 * discount represents depends on the price it is taken off: 100 off 500 is 20%,
 * and the same 100 off 1,000 is 10%. A flat discount stores no percentage, so
 * this is the only place that can produce one.
 */
export function deriveDiscount(
  regular: number,
  type: DiscountType,
  value: number,
): DerivedDiscount {
  const sale = salePrice(regular, type, value);
  const hasDiscount = value > 0 && sale < regular;
  const percent = hasDiscount
    ? type === "percentage"
      ? roundPercent(value)
      : roundPercent(((regular - sale) / regular) * 100)
    : 0;
  return {
    sale,
    percent,
    badgeLabel: hasDiscount ? discountBadgeLabel(type, value) : null,
    hasDiscount,
  };
}

/**
 * Normalises the three authoring modes into the one triple the server stores.
 *
 * Comparison mode is the only one that has to do arithmetic: the admin types an
 * old price and a new price, and the stored discount is the percentage between
 * them. Normalising here rather than in the form means the payload builder, the
 * badge preview and the mode-switching reducer cannot each round differently.
 */
export function normalizeDiscount(input: {
  mode: DiscountMode;
  regular: number;
  discountType: DiscountType;
  discountValue: number;
  comparisonPrice: number;
}): { regular: number; type: DiscountType; value: number } {
  const regular = input.regular;
  switch (input.mode) {
    case "comparison": {
      const pct = percentBetween(regular, input.comparisonPrice);
      // A new price at or above the old one is not a discount. Reporting it as
      // a negative markdown would put a badge on the product claiming a
      // surcharge, and `discount_value` is CHECKed non-negative, so the save
      // would fail with a database error instead of accepting "no discount".
      return { regular, type: "percentage", value: pct > 0 ? pct : 0 };
    }
    case "custom":
      return { regular, type: input.discountType, value: input.discountValue };
    case "promotion":
    case "none":
    default:
      // In promotion mode the markdown belongs to the promotion and is applied
      // at read time, so the product's own discount is deliberately zero. A
      // product markdown left over from custom mode would stack a second
      // markdown under the promotion's, and the shopper would be charged less
      // than either of the two advertised savings.
      return { regular, type: "percentage", value: 0 };
  }
}
