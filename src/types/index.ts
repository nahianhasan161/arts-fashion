export type UserRole = "user" | "admin" | "super_admin";

export type UserStatus = "active" | "banned" | "deleted";

/**
 * Visual style of a badge.
 *
 * Canonical here rather than in lib/badges so the domain unions live together;
 * badges.ts re-exports it for the display layer.
 *
 * A product's own badge is always `discount`, because it is derived from the
 * discount the product actually has. The other three are claims that are not
 * about price -- a seasonal, a "new arrival", a "popular" signal -- and a
 * promotion is the only surface that can make them, since a promotion is
 * something with dates and an owner behind it.
 */
export type BadgeType = "discount" | "new" | "festive" | "popular";

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  banned_at: string | null;
  deleted_at: string | null;
  updated_at: string;
  /**
   * A COPY of auth.users.email, maintained by the `on_auth_user_email_changed`
   * trigger. It was absent from this type even though the column has existed
   * since the table was created, and the omission is not cosmetic: with no
   * `email` to read, the admin user list had to call `auth.admin.listUsers()` to
   * recover addresses, and that call needs a service_role key and failed on
   * every request.
   *
   * auth.users remains the source of truth. This is a copy, so it can only be
   * as fresh as its trigger.
   */
  email: string | null;
}

export interface ProductColor {
  name: string;
  hex: string;
}

export interface ProductSize {
  size: string;
  chest: string;
  stock: number;
}

/** A canonical size label, from the `sizes` table. */
export interface SizeOption {
  id: string;
  /** Stored label, e.g. "m". */
  name: string;
  /** Shown to shoppers, e.g. "M" or "32". */
  display_name: string;
  type: string;
  is_active: boolean;
  display_order: number;
}

/**
 * One purchasable option: a colour, a size, or a specific pair.
 *
 * `color_id` and `size_id` are nullable on purpose. A null means the option
 * does not vary on that axis, not that it is unknown, and
 * `resolve_order_variant()` relies on that distinction: it treats a null as
 * "does not narrow the match" and refuses anything still ambiguous.
 *
 * `variant_key` is a generated column ("<color_id>:<size_id>") and is never
 * written by a client.
 */
export interface ProductVariant {
  id: string;
  product_id: string;
  color_id: string | null;
  size_id: string | null;
  variant_key: string;
  sku: string | null;
  regular_price_override: number | null;
  stock: number;
  is_active: boolean;
  /** Joined for the editor; not a column of product_variants. */
  color_name?: string | null;
  color_hex?: string | null;
  size_name?: string | null;
}

/** The draft shape the editor sends for a single cell of the matrix. */
export interface VariantDraft {
  color_id: string | null;
  size_id: string | null;
  stock: number;
  price_override: string | null;
  sku: string | null;
  is_active: boolean;
}

/**
 * A colour offered by a product.
 *
 * The canonical record is ColorPalette; is_active is optional because older
 * rows and the palette route's response may omit it, and an absent flag is
 * treated as available rather than as excluding the colour from the form.
 */
export type ColorOption = ColorPalette & { is_active?: boolean };


export interface Product {
  id: string;
  slug: string;
  title: string;
  category: string;
  sub_category?: string;
  /** FK columns present in the live schema; used to scope size charts. */
  category_id?: string | null;
  sub_category_id?: string | null;
  description: string;
  /**
   * Plain-text summary for cards, search rows and meta descriptions. The
   * `description` field is rich HTML and must not be dropped into an attribute;
   * this is the field written for that purpose. Optional, because products
   * created before it existed do not have one.
   */
  short_description?: string | null;
  price: number;
  original_price: number;
  /** Pre-discount price. Present in the live schema; drives promotion maths. */
  regular_price?: number | null;
  discount_type?: PromotionDiscountType;
  discount_value?: number;
  discount_percent: number;
  /**
   * How the admin expressed the discount when it was last saved. Recorded so
   * the form reopens on the model that was used rather than guessing from the
   * stored numbers; it changes no price. Absent on rows written before it
   * existed, which the form reads as "custom" when there is a discount and
   * "none" when there is not.
   */
  discount_mode?: ProductDiscountMode;
  images: string[];
  colors: ProductColor[];
  sizes: ProductSize[];
  stock: number;
  rating: number;
  reviews_count: number;
  /**
   * Server-derived badge text, e.g. "15% OFF". Deprecated as an authoring
   * field: it used to be typed by hand, which let it disagree with the price
   * beside it -- a product at its full price could carry "SALE" and one 40%
   * under could carry nothing. It is now written from the discount on every
   * save and read only as a fallback for rows with no live badge.
   */
  badge?: string;
  /** Derived alongside `badge`; `'discount'` when a discount exists, else null. */
  badge_type?: "discount" | "new" | "festive" | "popular";
  is_featured?: boolean;
  specs?: Record<string, string>;
  color_palette_ids?: string[];
  /**
   * Free merchandising tags, e.g. `["summer", "eid-collection"]`. Stored
   * verbatim, so compare case-insensitively rather than assuming normalised
   * text.
   */
  tags?: string[];
  /**
   * Unit acquisition cost. Absent means not recorded, which is distinct from
   * zero and must never be treated as free goods. Admin and reporting only:
   * this value must not reach a customer-facing price.
   */
  cost_price?: number | null;
  /** Publication state. Absent on rows written before it existed. */
  status?: ProductStatus;
  /**
   * Audience this product is sold to. Absent or null means not yet assigned,
   * which the admin filters treat as their own bucket rather than as "men".
   */
  gender?: ProductGender | null;
  created_at?: string;
  /**
   * Last write to the product row. Distinct from both `created_at` and
   * `published_at`: the admin list sorts on it and shows it in the table, since
   * "which of these did someone just fix" is the question a listing raises.
   */
  updated_at?: string;
  /**
   * When the product first went live. Distinct from `created_at`, which is
   * when the row was first typed in — a product drafted for a month and then
   * published is new on `published_at` and old on `created_at`.
   */
  published_at?: string | null;
  /**
   * When an admin retired the product. `null` is the normal state. A non-null
   * value means the row is kept for order history but is not buyable, so every
   * storefront read filters it out.
   */
  deleted_at?: string | null;
  /** Canonical option ids, when the product has a variant matrix. */
  color_ids?: string[];
  size_ids?: string[];
  variants?: ProductVariant[];
  promotion_ids?: string[];
}

export type ProductStatus = "draft" | "published" | "archived";

/**
 * The audience a product is sold to.
 *
 * Distinct from the category, which records what the garment is: a Polo is a
 * Polo whether it is sold to men, women or kids. `null` on a Product means not
 * yet assigned, which is a real state for a newly authored product and is not
 * the same as any of the three. The database constrains the column to exactly
 * these values or NULL.
 */
export type ProductGender = "men" | "women" | "kids";

/** The three audiences, for filter controls and option lists. */
export const PRODUCT_GENDERS: ProductGender[] = ["men", "women", "kids"];

/** Human labels. The stored value is always lower-case. */
export const PRODUCT_GENDER_LABELS: Record<ProductGender, string> = {
  men: "Men",
  women: "Women",
  kids: "Kids",
};

export function isProductGender(value: unknown): value is ProductGender {
  return value === "men" || value === "women" || value === "kids";
}

/**
 * How an admin chose to express a product's discount.
 *
 * Three ways of saying the same thing -- a pair of prices to compare, a manual
 * amount or percentage, or an existing promotion -- plus the absence of one.
 * The mode is a record of the authoring, not a different kind of discount: all
 * four normalise to the same stored (regular_price, discount_type,
 * discount_value) triple, which is why the storefront has one pricing path
 * rather than three.
 */
export type ProductDiscountMode = "none" | "comparison" | "custom" | "promotion";

export function isProductDiscountMode(value: unknown): value is ProductDiscountMode {
  return (
    value === "none" || value === "comparison" || value === "custom" || value === "promotion"
  );
}

export interface CartItem {
  id: string;
  productId: string;
  slug: string;
  title: string;
  price: number;
  original_price: number;
  image: string;
  size: string;
  color: string;
  quantity: number;
  maxStock: number;
}

export interface Category {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  children?: Category[];
  depth?: number;
}

export interface ColorPalette {
  id: string;
  name: string;
  hex: string;
  category_id: string | null;
  is_global: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export type SizeRegionCode = "GLOBAL" | "BD" | "US";

export type SizeUnit = "cm" | "in";

export type SizeLabelStyle = "letter" | "numeric";

export interface SizeRegion {
  code: SizeRegionCode;
  name: string;
  unit: SizeUnit;
  label_style: SizeLabelStyle;
  display_order: number;
}

export interface SizeMeasurement {
  id: string;
  size_id: string;
  region_code: SizeRegionCode;
  category_id: string | null;
  label_override: string | null;
  measurements: Record<string, number>;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface SizeLabel {
  id: string;
  name: string;
  display_name: string;
  type: string;
  is_active: boolean;
  display_order: number;
  sort_key: number;
  fit_type?: string;
  created_at?: string;
  updated_at?: string;
}

/** A size label joined with its regional measurement rows. */
export interface SizeLabelWithMeasurements extends SizeLabel {
  measurements: SizeMeasurement[];
}

/** One resolved row for a shopper: canonical size + regional presentation. */
export interface ResolvedSize {
  size_id: string;
  canonical_label: string;
  label: string;
  region_code: SizeRegionCode;
  unit: SizeUnit;
  label_style: SizeLabelStyle;
  measurements: Record<string, number>;
  display_order: number;
  /** Which scope matched, for debugging: subcategory | category | region | fallback */
  matched_scope: "category" | "region" | "fallback";
  category_name?: string | null;
}

export interface ResolvedSizeChart {
  region: SizeRegion;
  sizes: ResolvedSize[];
}

export const MEASUREMENT_KEYS: Record<string, string[]> = {
  clothing: ["chest", "waist", "hip", "length", "shoulder", "sleeve", "neck"],
  footwear: ["foot_length", "eu", "uk", "us"],
};

export const DEFAULT_SIZE_REGION: SizeRegionCode = "BD";

export type PromotionDiscountType = "flat" | "percentage";

export type PromotionStatus = "draft" | "active" | "cancelled";

/** Which rule produced the final price. */
export type PriceSource = "promotion" | "markdown" | "none";

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  discount_type: PromotionDiscountType;
  discount_value: number;
  starts_at: string;
  ends_at: string;
  status: PromotionStatus;
  badge_label: string | null;
  /**
   * Visual style of this promotion's badge. This is where festive / new /
   * popular now live: a product's own badge is always the discount it actually
   * has, so a badge that is not a discount has to come from a promotion, which
   * is also the only thing that can honestly claim to be a seasonal or
   * "popular" signal. Absent on rows written before the column existed, which
   * the display layers read as a discount badge.
   */
  badge_type?: BadgeType | null;
  created_at?: string;
  updated_at?: string;
}

export interface PromotionWithProducts extends Promotion {
  product_ids: string[];
  product_count: number;
  /** Server-computed: is the promotion live right now? */
  is_live: boolean;
}

export interface EffectivePrice {
  product_id: string;
  regular_price: number;
  base_price: number;
  final_price: number;
  discount_type: PromotionDiscountType | string;
  discount_value: number;
  promotion_id: string | null;
  promotion_name: string | null;
  source: PriceSource;
}

export interface PricingQuoteLine extends EffectivePrice {
  quantity: number;
  line_total: number;
  line_base_total: number;
  line_discount_total: number;
}

export interface PricingQuote {
  lines: PricingQuoteLine[];
  subtotal: number;
  discount_total: number;
}

export interface OrderCustomerInfo {
  name: string;
  phone: string;
  email?: string;
  address: string;
  city: "dhaka" | "outside";
  notes?: string;
}

export interface Order {
  id: string;
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  delivery_address: string;
  city: string;
  subtotal: number;
  shipping_fee: number;
  total_amount: number;
  payment_method: "cod" | "bkash" | "nagad";
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled" | "returned";
  items: CartItem[];
  created_at: string;
}

// ==========================================================
// Payments — Separate from Orders
// An order can have MULTIPLE payment transactions (charge, refund,
// chargeback). Each row is one atomic transaction.
// ==========================================================

export type PaymentType = "charge" | "refund" | "chargeback";
export type PaymentStatus =
  | "initiated"
  | "successful"
  | "failed"
  | "cancelled"
  | "refunded";
export type PaymentProvider = "cod" | "bkash" | "nagad" | "stripe" | "paypal";

export interface Payment {
  id: string;
  order_id: string;
  user_id: string | null;
  type: PaymentType;
  provider: PaymentProvider;
  provider_txn_id: string | null;
  amount: number;
  status: PaymentStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ==========================================================
// Returns — Order-level return + item-level detail
// ==========================================================

export type ReturnStatus =
  | "requested"
  | "approved"
  | "received"
  | "completed"
  | "rejected";

export interface Return {
  id: string;
  order_id: string;
  user_id: string | null;
  reason: string | null;
  status: ReturnStatus;
  refund_amount: number;
  refund_payment_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReturnItem {
  id: string;
  return_id: string;
  order_item_id: string;
  quantity: number;
  condition_at_return: string | null;
  created_at: string;
}

// ==========================================================
// Payment Webhooks — Audit trail for future MFS gateway
// ==========================================================

export interface PaymentWebhook {
  id: string;
  provider: string;
  event_type: string;
  provider_event_id: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
  created_at: string;
}

// ==========================================================
// Coupons
//
// Mirrors the SQL contract in supabase/migrations/2026092615*.sql.
// A coupon is the second discount layer: it STACKS on the
// post-promotion price, where a promotion REPLACES the markdown.
// ==========================================================

export type CouponStatus = "draft" | "active" | "cancelled";
export type CouponDiscountType = "flat" | "percentage";
export type CouponAppliesTo = "order" | "products";

export interface UserGroup {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface UserGroupWithCount extends UserGroup {
  member_count: number;
}

/** A group plus the members currently in it, for the admin editor. */
export interface UserGroupDetail extends UserGroup {
  members: GroupMember[];
}

export interface GroupMember {
  user_id: string;
  email: string | null;
  full_name: string | null;
  assigned_at: string;
}

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  group_id: string | null;
  group_name?: string | null;
  applies_to: CouponAppliesTo;
  discount_type: CouponDiscountType;
  discount_value: number;
  minimum_order_value: number;
  max_uses: number | null;
  max_uses_per_user: number;
  starts_at: string;
  ends_at: string;
  status: CouponStatus;
  created_at?: string;
  updated_at?: string;
}

export interface CouponWithUsage extends Coupon {
  product_ids: string[];
  product_count: number;
  is_live: boolean;
  times_used: number;
}

/**
 * Why a coupon was refused. The server returns one of these as `reason`;
 * the client maps it to a message. `coupon_login_required` is the only one
 * that changes what the page should offer to do next.
 */
export type CouponRejection =
  | "coupon_empty"
  | "coupon_not_found"
  | "coupon_inactive"
  | "coupon_not_started"
  | "coupon_expired"
  | "coupon_login_required"
  | "coupon_wrong_group"
  | "coupon_used_up"
  | "coupon_user_limit_reached"
  | "coupon_min_order"
  | "coupon_no_eligible_products";

export interface CouponQuoteSuccess {
  valid: true;
  coupon_id: string;
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  discount_base: number;
  discount_amount: number;
  applies_to: CouponAppliesTo;
}

export interface CouponQuoteFailure {
  valid: false;
  reason: CouponRejection;
  /** Present on coupon_min_order so the UI can say how much more is needed. */
  minimum_order_value?: number;
  discount_base?: number;
}

export type CouponQuote = CouponQuoteSuccess | CouponQuoteFailure;

/** Shape posted to /api/checkout. */
export interface CheckoutItemPayload {
  product_id: string;
  variant_id: string;
  title: string;
  size: string;
  color: string;
  quantity: number;
  image?: string;
}

export interface CheckoutRequest {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  delivery_address: string;
  city: string;
  shipping_fee: number;
  payment_method: "cod" | "bkash" | "nagad";
  coupon_code?: string;
  items: CheckoutItemPayload[];
}

export interface CheckoutResponse {
  success: boolean;
  order_id: string;
  subtotal: number;
  discount_total: number;
  coupon_discount_total: number;
  coupon_code: string | null;
  shipping_fee: number;
  total_amount: number;
  /** Set when the order was rejected; `order_id` is absent then. */
  error?: string;
}

// ==========================================================
// Product media
//
// product_images is the source of truth (one row per uploaded file).
// products.images is a projection the storefront reads, rebuilt by a
// database trigger on every write, so the two cannot drift.
// ==========================================================

export interface ProductImage {
  id: string;
  product_id: string;
  /** Object path inside the `product-images` bucket, e.g. "<productId>/<uuid>.webp". */
  storage_path: string;
  /** Public URL built by storage_public_url(). */
  url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  /** Local-only: set while an upload is in flight, for the progress UI. */
  uploading?: boolean;
  /** Local-only: upload failure message. */
  error?: string;
}

export type MediaUploadStatus = "idle" | "uploading" | "done" | "error";

export interface MediaUploadResult {
  uploaded: ProductImage[];
  failed: { name: string; reason: string }[];
}

/** Mirrors the bucket's allowed_mime_types and file_size_limit. */
export const MEDIA_ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_MAX_PER_PRODUCT = 12;

// ==========================================================
// Media library
//
// The library is a view, not a new source of truth: an item is a
// product_images row, and an attachment is a file staged before it
// belongs to a product. Both carry the same metadata, so the UI can
// treat them as one list with a flag rather than two grids.
// ==========================================================

export interface MediaFolder {
  id: string;
  name: string;
  parent_id: string | null;
}

/** A file in the library: either attached to a product or staged. */
export interface MediaItem {
  id: string;
  /** Absent for a staged file, which belongs to no product yet. */
  product_id?: string;
  storage_path: string;
  url: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  alt_text: string | null;
  folder_id: string | null;
  created_at?: string;
  /** Attached and referenced by its product's images array. */
  in_use?: boolean;
  is_primary?: boolean;
  sort_order?: number;
  /** Staged: uploaded but not yet attached to a product. */
  unattached?: boolean;
}

export interface MediaPage {
  items: MediaItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface MediaStats {
  total_bytes: number;
  file_count: number;
  product_count: number;
  unattached_count: number;
  without_alt: number;
  with_alt: number;
  by_mime: Record<string, number>;
  by_size: {
    under_100kb: number;
    under_500kb: number;
    under_1mb: number;
    over_1mb: number;
  };
  largest: MediaItem[];
}

export type MediaSort = "newest" | "oldest" | "name" | "size";

export interface MediaFilters {
  search: string;
  mime: string;
  folder: string;
  missingAlt: boolean;
  sort: MediaSort;
  offset: number;
  limit: number;
}
