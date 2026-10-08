/**
 * How a badge is coloured, in one place.
 *
 * A badge's type is the only input to its colour, and the type can come from
 * two sources that used to disagree: a product's own badge/badge_type pair,
 * and a promotion's badge. get_effective_badges() used to return the literal
 * 'discount' for every promotion, so a promotion labelled "Festive" rendered
 * in the discount red. That is fixed in the database; this file exists so the
 * two surfaces that render a badge cannot drift apart again, which is what
 * let them disagree in the first place.
 *
 * A new type needs one line here and nothing else.
 */

// The union lives with the other domain types and is re-exported here, because
// everything that draws a badge already imports from this file and the type
// should not need a second import path.
export type { BadgeType } from "@/types";
import type { BadgeType } from "@/types";

/** The four values accepted by products.badge_type and promotions.badge_type. */
export const BADGE_TYPES: readonly BadgeType[] = ["discount", "new", "festive", "popular"];

export const BADGE_TYPE_LABELS: Record<BadgeType, string> = {
  discount: "Discount",
  new: "New arrival",
  festive: "Festive",
  popular: "Popular",
};

/**
 * Returns the class for a badge, or null when there is nothing to show.
 *
 * An unknown type falls back to the discount style rather than rendering
 * unstyled, because a badge that loses its colour still has to be legible.
 */
export function badgeClass(type: string | null | undefined): string | null {
  switch (type) {
    case "discount":
      return "bg-badge-discount text-white";
    case "festive":
      return "bg-secondary text-white";
    case "new":
      return "bg-badge-new text-white";
    case "popular":
      // Popular is not a discount, so it must not borrow the discount red or a
      // shopper reads it as a saving rather than a signal.
      return "bg-primary text-white";
    default:
      return type ? "bg-badge-discount text-white" : null;
  }
}
