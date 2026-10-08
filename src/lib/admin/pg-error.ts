/**
 * Translation of the deliberate RAISE'd error names used by the admin RPCs
 * into HTTP responses.
 *
 * The functions in supabase/migrations raise a bare name such as
 * `unknown_color` with an ERRCODE chosen to match its meaning. The names are
 * the API's contract: the admin client matches on them to point at the field
 * that is wrong, so they must stay stable and must never leak a Postgres
 * message to the browser.
 */

const STATUS_BY_ERROR: Record<string, number> = {
  // Not signed in, or not an admin. 403 rather than 401 because
  // requireAdmin() has already established that a session exists.
  admin_required: 403,

  // A name the caller supplied, or a value it controls, was rejected. These
  // are the client's fault and are 400, not 500.
  title_required: 400,
  slug_required: 400,
  category_required: 400,
  category_not_found: 400,
  subcategory_not_found: 400,
  invalid_regular_price: 400,
  products_regular_price_positive: 400,
  invalid_discount_type: 400,
  invalid_discount: 400,
  invalid_percentage_discount: 400,
  invalid_flat_discount: 400,
  // The discount model the payload asked for is not one of the four, and a
  // comparison whose new price is negative. Both are named so the form can say
  // which of them happened rather than showing "invalid discount".
  invalid_discount_mode: 400,
  invalid_sale_price: 400,
  invalid_status: 400,
  invalid_gender: 400,
  invalid_cost_price: 400,
  invalid_variants: 400,
  unknown_color: 400,
  unknown_size: 400,
  unknown_promotion: 400,
  negative_stock: 400,
  too_many_variants: 400,
  product_id_required: 400,

  // Retiring a product that is already retired, and restoring one that is not.
  // Both are 409 rather than 400: the request was well formed, it conflicts
  // with the row's current state. Without these the delete route reported a
  // generic 500 for a plain double-click.
  product_already_deleted: 409,
  product_not_deleted: 409,

  // The slug is a shared, unique resource, so a collision is a conflict
  // rather than a malformed request.
  slug_taken: 409,

  // A UUID that is well formed but not in the table. For an id this is a
  // stale form: the product was deleted by someone else while the page was
  // open, and a reload is the correct response.
  product_not_found: 404,
};

/** Raised names that describe an input problem, for which 422 is more precise than 400. */
const ERROR_MESSAGES: Record<string, string> = {
  admin_required: "Administrator access is required.",
  title_required: "A product title is required.",
  slug_required: "A product slug is required.",
  slug_taken: "That slug is already used by another product.",
  category_required: "Choose a category.",
  category_not_found: "That category no longer exists. Reload and choose again.",
  subcategory_not_found: "That sub-category does not belong to the chosen category.",
  invalid_regular_price: "Enter a price greater than zero.",
  // The name of the check constraint, reached only if a save somehow trips it
  // without going through the guard that renames it. Mapped so it reads as the
  // same advice rather than as a Postgres sentence.
  products_regular_price_positive: "Enter a price greater than zero.",
  invalid_discount_type: "Choose a discount type of percentage or flat amount.",
  invalid_discount: "Enter a discount of zero or more.",
  invalid_percentage_discount: "A percentage discount cannot exceed 100.",
  invalid_flat_discount: "A flat discount cannot exceed the regular price.",
  invalid_discount_mode:
    "That discount type is not one of the four available. Reload the form and pick the discount again.",
  invalid_sale_price: "The new price cannot be negative.",
  invalid_status: "Choose a status of draft, published, or archived.",
  invalid_gender: "Choose an audience of Men, Women, or Kids.",
  invalid_cost_price: "Enter a cost of zero or more, or leave the field blank.",
  invalid_variants: "The variant list was not in a form the server could read.",
  unknown_color: "One of the selected colours no longer exists.",
  unknown_size: "One of the selected sizes no longer exists.",
  unknown_promotion: "One of the selected promotions no longer exists.",
  negative_stock: "Stock cannot be negative.",
  too_many_variants: "That many colour and size combinations exceeds the per-product limit.",
  product_id_required: "A product id is required.",
  product_already_deleted: "That product has already been removed.",
  product_not_deleted: "That product is not removed, so there is nothing to restore.",
  product_not_found: "That product no longer exists. Reload the list.",
};

/**
 * Postgres reports a raised name as `name` in `message`, or as the
 * `P0001` code with the name in the detail, depending on how the error
 * reached the client. Both spellings are read so a name is never missed.
 */
function raisedName(message: string): string | null {
  const direct = Object.keys(ERROR_MESSAGES).find((name) => message === name);
  if (direct) return direct;
  return Object.keys(ERROR_MESSAGES).find((name) => new RegExp(`\\b${name}\\b`).test(message)) ?? null;
}

export interface AdminPgError {
  error: string;
  code: string;
  status: number;
}

/**
 * Converts a thrown value into a response body and status.
 *
 * An unrecognised error is reported as a generic 500 with a log line: the
 * real message goes to the server log, not to the browser, because a Postgres
 * message can disclose schema details.
 */
export function describeAdminError(error: unknown): AdminPgError {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);

  const name = raisedName(message);
  if (name) {
    return {
      error: ERROR_MESSAGES[name] ?? name,
      code: name,
      status: STATUS_BY_ERROR[name] ?? 400,
    };
  }

  console.error("[admin] unhandled error while saving:", error);
  return { error: "Something went wrong. Check the server log.", code: "unknown", status: 500 };
}
