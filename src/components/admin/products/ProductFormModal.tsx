"use client";

/**
 * The product form, split out of the list page so the page holds the list and
 * this holds the editing.
 *
 * The shape of the state is the design. An earlier version kept one
 * `formDataState` object where the category and the sub-category were two
 * independent strings, and reconciled them with effects. Two effects each
 * derived a third field from the other two, and the result depended on the
 * order React happened to run them in, so choosing a sub-category could
 * overwrite the category with its parent's name while a stale sub-category
 * survived a change of parent.
 *
 * Here a category and a sub-category are ids, they live in one object, and the
 * invariant is maintained in the reducer rather than after the fact:
 *
 *   - a sub-category is only ever cleared or replaced by the reducer, never by
 *     an effect reacting to a change elsewhere;
 *   - a sub-category that does not belong to the selected parent is dropped at
 *     the moment the parent changes, so it cannot be submitted;
 *   - category and sub-category names are never stored. The server writes them
 *     from the ids, and the trigger keeps them in step, so the two cannot
 *     disagree.
 */

import { useCallback, useMemo, useReducer, useState } from "react";
import { X, Check } from "lucide-react";
import ProductMediaManager from "@/components/admin/ProductMediaManager";
import { RichTextEditor } from "@/components/admin/products/RichTextEditor";
import {
  VariantMatrix,
  cellKey,
  emptyCell,
  type CellKey,
  type MatrixCell,
  type MatrixState,
} from "@/components/admin/products/VariantMatrix";
import {
  PRODUCT_GENDERS,
  PRODUCT_GENDER_LABELS,
  isProductDiscountMode,
  isProductGender,
  type Category,
  type ColorOption,
  type Product,
  type ProductDiscountMode,
  type ProductGender,
  type ProductStatus,
  type Promotion,
  type SizeOption,
} from "@/types";
import {
  DISCOUNT_MODES,
  DISCOUNT_MODE_LABELS,
  deriveDiscount,
  formatTaka,
  normalizeDiscount,
  salePrice,
} from "@/lib/pricing";
import { badgeClass } from "@/lib/badges";

const statusOptions: { value: ProductStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

type DiscountType = "percentage" | "flat";

/**
 * How the discount fields are arranged, per mode. `usesRegular` is the one that
 * matters: every mode needs a base price, but only the two that express a
 * markdown in the product itself (comparison, custom) take the base price as
 * their own input, while "none" and "promotion" only show it as the reference
 * the saving is measured against.
 */
const MODE_HELP: Record<ProductDiscountMode, string> = {
  none: "The product is sold at its price, with no discount.",
  comparison:
    "Enter the price it used to be and the price it is now. The saving is worked out for you.",
  custom: "Take an amount or a percentage off the price by hand.",
  promotion:
    "The linked promotion decides the price while its dates are live, and supplies the badge. Switch to another mode to discount this product directly.",
};

/** Slug rules mirror the column's: lower case, digits, and single dashes. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * What the admin can edit, as ids rather than as names or JSON.
 *
 * `colorIds` and `sizeIds` define the shape of the matrix; `matrix` holds the
 * per-pair values. The two are separate because removing a colour must drop its
 * row and its cells together, and a flat map of cells cannot express which
 * cells should still be there.
 *
 * The three money fields are the price model the server actually implements:
 * one base price and one discount. There is deliberately no second price
 * field. The function derives the sale price and the crossed-out price from
 * these three, and a form that also showed a "Price" and an "Original Price"
 * was sending keys the function never read, so both were discarded and every
 * product saved through it was stored at zero. A field whose value is ignored
 * is worse than no field, because the admin sees it and believes it.
 */
/**
 * One editable spec pair.
 *
 * `uid` exists because the rows used to be keyed by their array index, which
 * is a real defect rather than a style preference. React keeps the DOM node
 * and the controlled value belonging to a position, so deleting the first of
 * three rows re-uses the second row's node for the third: the inputs came back
 * showing the wrong pair, and because both inputs are controlled the wrong text
 * was then saved. A stable per-row id makes a delete remove exactly one row.
 */
interface SpecRow {
  uid: string;
  key: string;
  value: string;
}

/** Monotonic within a mounted form; the value only has to be unique per session. */
let specUid = 0;
const nextSpecUid = () => `spec-${++specUid}`;

interface FormState {
  title: string;
  slug: string;
  categoryId: string;
  subCategoryId: string;
  description: string;
  /** Pre-discount price. Sends regular_price. */
  regular_price: number;
  /**
   * How the admin chose to express the discount. Sent as `discount_mode` so the
   * form reopens on the model that was used, rather than guessing from the
   * stored numbers and showing a promotion-driven markdown as a manual one.
   */
  discount_mode: ProductDiscountMode;
  discount_type: DiscountType;
  /** Sends discount_value. A percentage, or a flat amount off. */
  discount_value: number;
  /**
   * The "new price" of price-comparison mode. Sends `comparison_price`, and is
   * NOT stored: the server turns it into a percentage and re-derives the sale
   * price from that, so the price the admin typed can never disagree with the
   * badge describing it.
   */
  comparison_price: number;
  stock: number;
  is_featured: boolean;
  status: ProductStatus;
  /**
   * Audience the product is sold to, or null when not assigned.
   *
   * null rather than "" on purpose. The <select> renders "not assigned" as an
   * empty option value, but the state models the database: three audiences or
   * nothing. A union with the empty string here also breaks useReducer's
   * overload resolution, which is how a four-value dropdown became a
   * twenty-eight-error cascade the first time it was added.
   */
  gender: ProductGender | null;
  specs: SpecRow[];
  colorIds: string[];
  sizeIds: string[];
  matrix: MatrixState;
  promotionIds: string[];
}

/** Object.entries for a Record keyed by a template literal type. */
const entriesOf = (state: MatrixState) => Object.entries(state) as [CellKey, MatrixCell][];

type Action =
  | { type: "set"; field: keyof FormState; value: FormState[keyof FormState] }
  | { type: "category"; id: string; categories: Category[] }
  | { type: "subCategory"; id: string }
  | { type: "toggleColor"; id: string }
  | { type: "toggleSize"; id: string }
  | { type: "matrix"; value: MatrixState }
  | { type: "setDiscountMode"; mode: ProductDiscountMode }
  | { type: "togglePromotion"; id: string }
  | { type: "specKey"; index: number; value: string }
  | { type: "specValue"; index: number; value: string }
  | { type: "addSpec" }
  | { type: "removeSpec"; index: number };

function blankState(): FormState {
  return {
    title: "",
    slug: "",
    categoryId: "",
    subCategoryId: "",
    description: "",
    regular_price: 0,
    discount_mode: "none",
    discount_type: "percentage",
    discount_value: 0,
    comparison_price: 0,
    stock: 0,
    is_featured: false,
    status: "draft",
    gender: null,
    specs: [],
    colorIds: [],
    sizeIds: [],
    matrix: {},
    promotionIds: [],
  };
}

/**
 * Rebuilds the matrix from a product's option ids and its stored variants.
 *
 * Cells that the product does not have are still created, with zero stock,
 * because a colour and a size that are both selected always produce a variant:
 * the server creates the whole cross-product, so a cell missing from the form
 * is a zero-stock variant and not an absent one. Reading it the other way would
 * make an unedited cell disappear from the grid and take the variant with it.
 */
function matrixFromProduct(product: Product): MatrixState {
  const matrix: MatrixState = {};
  const colorIds = product.color_ids ?? [];
  const sizeIds = product.size_ids ?? [];

  // Keyed by the FORM's own cellKey, rebuilt from each variant's color_id and
  // size_id, rather than by the variant's `variant_key` column.
  //
  // The two used different conventions. cellKey renders a missing axis as
  // "-", while the database generates variant_key as
  // COALESCE(color_id,'') || ':' || COALESCE(size_id,'') -- an empty string.
  // So a product with colours but no sizes looked up "<colour>:-" and never
  // found the stored "<colour>:", every cell silently fell back to
  // emptyCell(), and saving the form then wrote stock 0 and cleared the SKU.
  // Rebuilding the key from the ids means this cannot drift again if the
  // generated column's format ever changes.
  const byKey = new Map(
    (product.variants ?? []).map((v) => [cellKey(v.color_id, v.size_id), v]),
  );

  if (colorIds.length > 0 && sizeIds.length > 0) {
    for (const c of colorIds) {
      for (const s of sizeIds) {
        const v = byKey.get(cellKey(c, s));
        matrix[cellKey(c, s)] = v
          ? {
              stock: v.stock,
              price_override: v.regular_price_override === null ? null : String(v.regular_price_override),
              sku: v.sku,
              is_active: v.is_active,
            }
          : emptyCell();
      }
    }
  } else {
    for (const c of colorIds) {
      const v = byKey.get(cellKey(c, null));
      matrix[cellKey(c, null)] = v
        ? {
            stock: v.stock,
            price_override: v.regular_price_override === null ? null : String(v.regular_price_override),
            sku: v.sku,
            is_active: v.is_active,
          }
        : emptyCell();
    }
    for (const s of sizeIds) {
      const v = byKey.get(cellKey(null, s));
      matrix[cellKey(null, s)] = v
        ? {
            stock: v.stock,
            price_override: v.regular_price_override === null ? null : String(v.regular_price_override),
            sku: v.sku,
            is_active: v.is_active,
          }
        : emptyCell();
    }
  }
  return matrix;
}

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value } as FormState;

    case "category": {
      // Changing the parent invalidates the sub-category unless it still sits
      // under the new parent. This is the only place a sub-category is
      // cleared, which is why it cannot go stale.
      const sub = action.categories.find((c) => c.id === state.subCategoryId);
      const keep = sub && sub.parent_id === action.id ? state.subCategoryId : "";
      return { ...state, categoryId: action.id, subCategoryId: keep };
    }

    case "subCategory":
      return { ...state, subCategoryId: action.id };

    case "toggleColor": {
      const has = state.colorIds.includes(action.id);
      const colorIds = has ? state.colorIds.filter((id) => id !== action.id) : [...state.colorIds, action.id];
      // Cells for a removed colour go with it, so the grid and the payload
      // never disagree about which rows exist.
      // Object.entries widens the key to string, so each surviving pair is
      // rebuilt through cellKey to keep the state typed as CellKey.
      const matrix: MatrixState = {};
      for (const [key, cell] of entriesOf(state.matrix)) {
        const [colorId] = key.split(":");
        if (!colorIds.includes(colorId)) continue;
        matrix[cellKey(colorId, key.split(":")[1])] = cell;
      }
      return { ...state, colorIds, matrix };
    }

    case "toggleSize": {
      const has = state.sizeIds.includes(action.id);
      const sizeIds = has ? state.sizeIds.filter((id) => id !== action.id) : [...state.sizeIds, action.id];
      const matrix: MatrixState = {};
      for (const [key, cell] of entriesOf(state.matrix)) {
        const [, sizeId] = key.split(":");
        if (!sizeIds.includes(sizeId)) continue;
        matrix[cellKey(key.split(":")[0], sizeId)] = cell;
      }
      return { ...state, sizeIds, matrix };
    }

    case "matrix":
      return { ...state, matrix: action.value };

    case "setDiscountMode": {
      // Switching mode must CONVERT, not discard.
      //
      // The alternative -- clearing the other mode's fields -- makes the mode
      // selector a trap: an admin who types 20% by hand, clicks "Price
      // comparison" to see the same thing as a before/after pair, and clicks
      // back has silently lost their 20%. So the discount currently in force is
      // converted into whatever the new mode needs, in both directions:
      //
      //   - the new price of comparison mode is seeded with the sale price the
      //     current mode produces, so the comparison opens on the markdown
      //     already in effect;
      //   - custom mode is seeded with the markdown of the mode being left,
      //     translated into the custom type, so a 150-off price arrives as
      //     "150 off" rather than as "0%".
      //
      // Leaving custom or comparison for none or promotion zeroes the
      // markdown, which is the point of those modes: a promotion discount must
      // not stack under a leftover product markdown.
      const current = normalizeDiscount({
        mode: state.discount_mode,
        regular: state.regular_price,
        discountType: state.discount_type,
        discountValue: state.discount_value,
        comparisonPrice: state.comparison_price,
      });
      const currentSale = salePrice(current.regular, current.type, current.value);

      // Percentage first: a flat markdown converted straight to a percentage
      // would round-trip badly (150 off 1,000 is 15%, which is fine, but 150
      // off 700 is 21.43% and comes back as 149.99 off). Converting a flat
      // markdown to its own type keeps it exact.
      const wasPercentage = current.type === "percentage" && current.value > 0;

      return {
        ...state,
        discount_mode: action.mode,
        // A product with no price yet has no sale price to seed from, so the new
        // price starts on the base price rather than on 0 -- an empty
        // comparison reading "100% off" is a worse first impression than one
        // reading "no change yet".
        comparison_price: currentSale > 0 ? currentSale : state.regular_price,
        discount_type: wasPercentage ? "percentage" : "flat",
        discount_value: wasPercentage
          ? current.value
          : Math.max(0, Math.round((current.regular - currentSale) * 100) / 100),
      };
    }

    case "togglePromotion":
      return {
        ...state,
        promotionIds: state.promotionIds.includes(action.id)
          ? state.promotionIds.filter((id) => id !== action.id)
          : [...state.promotionIds, action.id],
      };

    case "specKey":
      return {
        ...state,
        specs: state.specs.map((s, i) => (i === action.index ? { ...s, key: action.value } : s)),
      };

    case "specValue":
      return {
        ...state,
        specs: state.specs.map((s, i) => (i === action.index ? { ...s, value: action.value } : s)),
      };

    case "addSpec":
      return { ...state, specs: [...state.specs, { uid: nextSpecUid(), key: "", value: "" }] };

    case "removeSpec":
      return { ...state, specs: state.specs.filter((_, i) => i !== action.index) };
  }
}

export interface ProductFormOptions {
  categories: Category[];
  colors: ColorOption[];
  sizes: SizeOption[];
  promotions: Promotion[];
  categoriesLoading: boolean;
  colorsLoading: boolean;
  sizesLoading: boolean;
  promotionsLoading: boolean;
}

export interface ProductFormModalProps extends ProductFormOptions {
  product: Product | null;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20";
const labelClass = "block text-xs font-semibold text-on-surface mb-1.5";
const fieldClass = "w-full h-9 px-3 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 appearance-none bg-white";
const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-border-light px-2.5 py-1 text-xs cursor-pointer transition-colors";

/** The native select, kept in one place so the disabled and loading states match. */
function Dropdown({
  label,
  value,
  onChange,
  children,
  disabled,
  required,
  loading,
  hint,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  loading?: boolean;
  hint?: string;
  id: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="text-badge-discount"> *</span>}
      </label>
      {loading ? (
        <div className={fieldClass + " bg-surface-subtle animate-pulse"} aria-hidden />
      ) : (
        <select
          id={id}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
        >
          {children}
        </select>
      )}
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

export function ProductFormModal({
  product,
  categories,
  colors,
  sizes,
  promotions,
  categoriesLoading,
  colorsLoading,
  sizesLoading,
  promotionsLoading,
  onClose,
  onSuccess,
}: ProductFormModalProps) {
  const isEdit = product !== null;
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(isEdit);

  const [state, dispatch] = useReducer(reducer, product, (p) => {
    if (!p) return blankState();
    return {
      ...blankState(),
      title: p.title ?? "",
      slug: p.slug ?? "",
      // The ids are the authority. A product whose category_id is NULL but
      // whose name is set is a row written before the id existed; it is shown
      // unassigned rather than guessed at, because guessing would attach it to
      // a parent it never had.
      categoryId: p.category_id ?? "",
      subCategoryId: p.sub_category_id ?? "",
      description: p.description ?? "",
      // Read from regular_price, which is what the server writes and the only
      // one of the three money columns that is an input rather than a derived
      // output. Falling back to price would let a legacy 0-price row look
      // populated in the form and be re-saved as a free product.
      regular_price: Number(p.regular_price ?? 0),
      // Rows written before discount_mode existed are read the way the
      // migration backfilled them: a discount means 'custom', no discount with
      // a promotion linked means 'promotion', otherwise 'none'. Guessing from
      // the numbers rather than falling back to a fixed default is what lets an
      // old product reopen on the model it was actually saved with.
      discount_mode:
        p.discount_mode && isProductDiscountMode(p.discount_mode)
          ? p.discount_mode
          : Number(p.discount_value ?? 0) > 0
            ? "custom"
            : (p.promotion_ids?.length ?? 0) > 0
              ? "promotion"
              : "none",
      discount_type: (p.discount_type ?? "percentage") as DiscountType,
      discount_value: Number(p.discount_value ?? 0),
      // The new price of comparison mode is the stored sale price, so
      // comparison mode round-trips a product saved through it instead of
      // coming back with an empty second field.
      comparison_price: Number(p.price ?? p.regular_price ?? 0),
      stock: Number(p.stock ?? 0),
      is_featured: p.is_featured ?? false,
      status: p.status ?? "draft",
      // Read through the type guard rather than cast: the column is
      // CHECK-constrained, but a value written before the check existed, or by
      // a direct SQL write, must not put an unrecognised string into the select
      // where React would render it as an option with no label.
      gender: p.gender && isProductGender(p.gender) ? p.gender : null,
      specs: Object.entries(p.specs ?? {}).map(([key, value]) => ({
        uid: nextSpecUid(),
        key,
        value: String(value),
      })),
      colorIds: p.color_ids ?? [],
      sizeIds: p.size_ids ?? [],
      matrix: matrixFromProduct(p),
      promotionIds: p.promotion_ids ?? [],
    };
  });

  // The categories arrive after the form mounts, so a product can be opened
  // before its parent is known. Until they do, the sub-category dropdown is
  // empty and the id is left alone: rewriting it here is what used to drop a
  // valid sub-category whenever the category list was refetched.
  const parents = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const children = useMemo(
    () => categories.filter((c) => !!c.parent_id && c.parent_id === state.categoryId),
    [categories, state.categoryId],
  );

  const chosenColors = useMemo(
    () => colors.filter((c) => state.colorIds.includes(c.id)),
    [colors, state.colorIds],
  );
  const chosenSizes = useMemo(() => sizes.filter((s) => state.sizeIds.includes(s.id)), [sizes, state.sizeIds]);

  const set = useCallback(
    <K extends keyof FormState>(field: K, value: FormState[K]) => dispatch({ type: "set", field, value }),
    [],
  );

  // The slug follows the title until it is edited by hand, then it is left
  // alone: a slug that changes after a product has been shared is a broken
  // link, and overwriting an admin's deliberate slug is worse than an untidy
  // generated one.
  const onTitleChange = (value: string) => {
    dispatch({ type: "set", field: "title", value });
    if (!slugTouched) dispatch({ type: "set", field: "slug", value: slugify(value) });
  };

  const totalStock = useMemo(
    () => Object.values(state.matrix).reduce((sum, cell) => sum + (cell.is_active ? cell.stock : 0), 0),
    [state.matrix],
  );

  // The discount, normalised once.
  //
  // The three authoring modes collapse to one (regular_price, discount_type,
  // discount_value) triple, and everything below -- the price preview, the
  // badge preview, the comparison readout, the payload -- reads this one value
  // rather than each re-deriving the mode. That is what keeps the badge the
  // admin sees in the form identical to the badge the storefront renders, and
  // the price preview identical to the price that gets stored.
  const discount = useMemo(
    () =>
      normalizeDiscount({
        mode: state.discount_mode,
        regular: state.regular_price,
        discountType: state.discount_type,
        discountValue: state.discount_value,
        comparisonPrice: state.comparison_price,
      }),
    [
      state.discount_mode,
      state.regular_price,
      state.discount_type,
      state.discount_value,
      state.comparison_price,
    ],
  );

  const derived = useMemo(
    () => deriveDiscount(state.regular_price, discount.type, discount.value),
    [state.regular_price, discount.type, discount.value],
  );

  // The badge the storefront will show, in the wording it will use.
  //
  // In promotion mode the badge is the promotion's own: its label if it has
  // one, otherwise its discount, styled with its own badge_type. Previewing the
  // product's own "15% OFF" there instead would show the admin one badge and
  // ship another, and the promotion's badge is the one that carries a seasonal
  // or "popular" claim rather than a price one.
  const badgePreview = useMemo(() => {
    if (state.discount_mode === "promotion") {
      const chosen = promotions.filter((p) => state.promotionIds.includes(p.id));
      const promo = chosen[0];
      if (!promo) return null;
      const label =
        promo.badge_label?.trim() ||
        (promo.discount_type === "percentage"
          ? `${Math.round(Number(promo.discount_value))}% OFF`
          : `${Number(promo.discount_value)} OFF`);
      return {
        label,
        type: promo.badge_type ?? "discount",
        // What the promotion does to THIS product's price, which is the number
        // an admin is actually deciding on.
        sale: salePrice(
          state.regular_price,
          promo.discount_type as DiscountType,
          Number(promo.discount_value),
        ),
        source: promo.name,
      };
    }
    if (!derived.badgeLabel) return null;
    return { label: derived.badgeLabel, type: "discount" as const, sale: derived.sale, source: null };
  }, [
    state.discount_mode,
    state.promotionIds,
    state.regular_price,
    promotions,
    derived.badgeLabel,
    derived.sale,
  ]);

  /**
   * The payload. Names for the category and sub-category are deliberately
   * absent: the server resolves them from the ids and a trigger keeps the two
   * columns in step, so sending a name would give the client a second way to
   * set the same fact.
   *
   * price, original_price and discount_percent are just as deliberately
   * absent, because the server derives all three from regular_price and the
   * discount below. Sending a sale price would be sending a value the server
   * ignores, which is how a 0-price product looks deliberate to the next
   * person to read this code.
   *
   * `stock` is absent for the same reason, and it was a real omission until
   * this pass: admin_save_product never wrote products.stock. A trigger keeps
   * it equal to the sum of the active variants, so the number the Stock field
   * displayed was already not the number that would be stored. The field
   * itself is kept, because the admin still sets per-variant stock in the
   * matrix and the product total is useful to see, but it is labelled as
   * derived and it is not sent.
   */
  const buildPayload = () => {
    const specs: Record<string, string> = {};
    for (const { key, value } of state.specs) {
      const k = key.trim();
      // A pair with a value but no name cannot be stored, because specs is an
      // object keyed by name. Dropping it silently would lose the value.
      if (k) specs[k] = value;
    }

    return {
      ...(isEdit ? { id: product!.id } : {}),
      title: state.title.trim(),
      slug: state.slug.trim(),
      category_id: state.categoryId || null,
      sub_category_id: state.subCategoryId || null,
      description: state.description,
      regular_price: state.regular_price,
      // The mode, the mode's own inputs, and nothing derived. The server
      // normalises the four modes onto one (regular_price, discount_type,
      // discount_value) triple and derives the sale price, the percentage and
      // the badge from it, so this payload carries only what the admin chose.
      discount_mode: state.discount_mode,
      discount_type: state.discount_type,
      discount_value: state.discount_value,
      comparison_price: state.comparison_price,
      // badge and badge_type are NOT sent. They are derived from the discount
      // above, on every save, by the server -- which is what stops a badge from
      // being able to contradict the price beside it.
      is_featured: state.is_featured,
      status: state.status,
      // Sent as JSON null, which the server's NULLIF turns into SQL NULL, so
      // "not assigned" stays distinct from all three audiences and the
      // Unassigned filter bucket remains reachable.
      gender: state.gender,
      specs,
      color_ids: state.colorIds,
      size_ids: state.sizeIds,
      promotion_ids: state.promotionIds,
      // Every selected pair is sent, including the ones at zero stock, so the
      // matrix the server builds is the one on screen.
      variants: Object.entries(state.matrix).map(([key, cell]) => {
        const [colorId, sizeId] = key.split(":");
        return {
          color_id: colorId === "-" ? null : colorId,
          size_id: sizeId === "-" ? null : sizeId,
          stock: cell.stock,
          price_override: cell.price_override === null || cell.price_override === "" ? null : cell.price_override,
          sku: cell.sku,
          is_active: cell.is_active,
        };
      }),
    };
  };

  const handleSubmit = async () => {
    setFormError(null);

    if (!state.title.trim()) {
      setFormError("A title is required.");
      return;
    }
    if (!state.slug.trim()) {
      setFormError("A slug is required.");
      return;
    }
    if (!state.categoryId) {
      setFormError("Choose a category.");
      return;
    }
    // The database refuses a non-positive price, so this check is not a
    // nicety: without it the save would fail with a sentence written for a
    // database reader rather than for the person holding the form.
    if (!(state.regular_price > 0)) {
      setFormError("Enter a price greater than zero.");
      return;
    }
    // The discount is validated through the same normalisation the payload is
    // built with, so what is checked here is what will actually be stored. The
    // old checks were written against discount_type/discount_value directly,
    // which meant they silently did not apply in comparison mode -- the mode
    // whose whole purpose is a new price, and the one most likely to be typed
    // badly.
    if (state.discount_mode === "comparison") {
      if (state.comparison_price < 0) {
        setFormError("The new price cannot be negative.");
        return;
      }
      if (state.comparison_price > state.regular_price) {
        setFormError(
          "The new price is higher than the old price, which is a price rise rather than a discount. Use a custom discount of zero, or lower the old price.",
        );
        return;
      }
    }
    if (state.discount_mode === "custom") {
      if (state.discount_value < 0) {
        setFormError("A discount cannot be negative.");
        return;
      }
      if (state.discount_type === "percentage" && state.discount_value > 100) {
        setFormError("A percentage discount cannot be more than 100.");
        return;
      }
      if (state.discount_type === "flat" && state.discount_value > state.regular_price) {
        setFormError("A flat discount cannot be more than the price.");
        return;
      }
    }
    if (state.discount_mode === "promotion" && state.promotionIds.length === 0) {
      setFormError("Choose a promotion, or switch to another discount mode.");
      return;
    }
    const unnamedSpec = state.specs.some((s) => !s.key.trim() && s.value.trim());
    if (unnamedSpec) {
      setFormError("Every spec needs a name, or the value has nowhere to go.");
      return;
    }
    // specs is an object keyed by name, so two rows sharing a name are one row
    // and the second silently overwrites the first. "Fabric: Cotton" and
    // "Fabric: Linen" saved as a single Fabric spec reading "Linen", and the
    // admin was shown no warning. Case-insensitive because the storefront
    // shows names as labels, where "Fabric" and "fabric" read as one spec.
    const seenSpecs = new Set<string>();
    let duplicateSpec: string | null = null;
    for (const s of state.specs) {
      const k = s.key.trim().toLowerCase();
      if (!k) continue;
      if (seenSpecs.has(k)) {
        duplicateSpec = s.key.trim();
        break;
      }
      seenSpecs.add(k);
    }
    if (duplicateSpec) {
      setFormError(`Two specs are both named "${duplicateSpec}". Spec names have to be different.`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/products", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data: { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save product");
      }
      onSuccess();
    } catch (err) {
      // The message comes from the server's own wording, which already names
      // the field that is wrong, so it is shown as-is.
      setFormError(err instanceof Error ? err.message : "Failed to save product");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // role="dialog" and aria-modal, so a screen reader announces this as a
    // dialog and the content behind it is treated as inert. Without them the
    // modal is just a div, and there is no way to close it from the keyboard
    // at all: Escape did nothing and the backdrop was not clickable.
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        // mousedown, not click, so a drag that starts inside the panel and
        // ends on the backdrop does not discard the form. The check is on the
        // backdrop itself: React's onMouseDown on the wrapper would also fire
        // for clicks on children, which is why e.target is compared.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pf-title-heading"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="bg-surface-card rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-border-light flex items-center justify-between">
          <h2 id="pf-title-heading" className="font-display text-xl font-bold text-primary">
            {isEdit ? "Edit Product" : "Add New Product"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {formError && (
            <div className="bg-badge-discount/10 border border-badge-discount/30 rounded-lg p-3" role="alert">
              <p className="text-badge-discount text-sm">{formError}</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="pf-title" className={labelClass}>
                Title *
              </label>
              <input
                id="pf-title"
                type="text"
                value={state.title}
                onChange={(e) => onTitleChange(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="pf-slug" className={labelClass}>
                Slug *
              </label>
              <input
                id="pf-slug"
                type="text"
                value={state.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", slugify(e.target.value));
                }}
                className={inputClass}
              />
            </div>

            <Dropdown
              id="pf-category"
              label="Category"
              required
              loading={categoriesLoading}
              value={state.categoryId}
              onChange={(id) => dispatch({ type: "category", id, categories })}
            >
              <option value="">Select category</option>
              {parents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Dropdown>

            <Dropdown
              id="pf-subcategory"
              label="Sub-category"
              value={state.subCategoryId}
              disabled={!state.categoryId}
              loading={categoriesLoading}
              hint={
                !state.categoryId
                  ? "Choose a category first."
                  : children.length === 0
                    ? "This category has no sub-categories."
                    : undefined
              }
              onChange={(id) => dispatch({ type: "subCategory", id })}
            >
              <option value="">No sub-category</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Dropdown>

            <div>
              <label htmlFor="pf-price" className={labelClass}>
                Price *
              </label>
              <input
                id="pf-price"
                type="number"
                min={0}
                step="0.01"
                value={state.regular_price || ""}
                onChange={(e) => set("regular_price", parseFloat(e.target.value) || 0)}
                className={inputClass}
                placeholder="4500"
              />
              {state.regular_price > 0 && (
                <p className="mt-1 text-[11px] text-text-muted">
                  {state.discount_mode === "promotion" ? (
                    <>
                      Shoppers pay {formatTaka(derived.sale)}, or the promotion price while it runs —
                      whichever is lower. The storefront price is worked out on the server.
                    </>
                  ) : (
                    <>
                      Shoppers pay{" "}
                      <span className="font-semibold text-on-surface">
                        {formatTaka(derived.sale)}
                      </span>
                      {derived.hasDiscount && (
                        <>
                          , reduced from{" "}
                          <span className="line-through">{formatTaka(state.regular_price)}</span>
                        </>
                      )}
                      . The storefront price is worked out on the server.
                    </>
                  )}
                </p>
              )}
            </div>

            <Dropdown
              id="pf-status"
              label="Status"
              value={state.status}
              onChange={(v) => set("status", v as ProductStatus)}
            >
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Dropdown>

            <Dropdown
              id="pf-gender"
              label="Gender / Age Category"
              // The select's "not assigned" option has an empty value, so the
              // empty string is translated back to null on the way in. The two
              // are the same thing to the database and different things to a
              // <select>.
              value={state.gender ?? ""}
              onChange={(v) =>
                set("gender", v === "" ? null : (v as ProductGender))
              }
              hint={
                state.gender
                  ? `Shown in the ${
                      PRODUCT_GENDER_LABELS[state.gender]
                    } section of the storefront.`
                  : "Not assigned. The product still saves and still shows in Shop All, but it will be missing from the Men, Women and Kids sections until this is set."
              }
            >
              <option value="">Not assigned</option>
              {PRODUCT_GENDERS.map((g) => (
                <option key={g} value={g}>
                  {PRODUCT_GENDER_LABELS[g]}
                </option>
              ))}
            </Dropdown>

            <div>
              <label htmlFor="pf-stock" className={labelClass}>
                Stock
              </label>
              <input
                id="pf-stock"
                type="number"
                min={0}
                disabled={state.colorIds.length > 0 || state.sizeIds.length > 0}
                value={state.colorIds.length > 0 || state.sizeIds.length > 0 ? totalStock : state.stock}
                onChange={(e) => set("stock", parseInt(e.target.value, 10) || 0)}
                className={inputClass + (state.colorIds.length > 0 || state.sizeIds.length > 0 ? " bg-surface-subtle" : "")}
                title={
                  state.colorIds.length > 0 || state.sizeIds.length > 0
                    ? "With colours or sizes chosen, stock is the total across the matrix."
                    : undefined
                }
              />
              {(state.colorIds.length > 0 || state.sizeIds.length > 0) && (
                <p className="mt-1 text-[11px] text-text-muted">
                  This is the total across every variant, recalculated by the database. Set each
                  figure in the matrix below.
                </p>
              )}
            </div>

          </div>

          {/*
            The Discount module.

            This replaces three separate fields -- a discount type and value, a
            free-text Badge, and a Badge Type dropdown -- plus the standalone
            Promotions picker. Those were four controls describing one thing, and
            nothing connected them: the badge was typed by hand beside a price the
            server had derived, so a product could be labelled SALE at full price
            and a product 40% under could carry no badge at all, with no check
            anywhere able to notice. Everything a shopper sees about the saving now
            comes from the numbers below, and the badge is what those numbers say
            rather than a second opinion about them.
          */}
          <div className="border border-border-light rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={labelClass}>Discount</p>
                <p className="text-[11px] text-text-muted">
                  {MODE_HELP[state.discount_mode]}
                </p>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Discount mode">
                {DISCOUNT_MODES.map((m) => {
                  const on = state.discount_mode === m;
                  // Promotion is offered only when there is something to select.
                  // An empty promotion list is not a reason to hide the mode --
                  // it is a reason to say so inside it.
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      onClick={() => dispatch({ type: "setDiscountMode", mode: m })}
                      className={`px-3 h-8 text-xs font-semibold rounded-lg border transition-colors ${
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border-light text-text-muted hover:border-primary/40"
                      }`}
                    >
                      {DISCOUNT_MODE_LABELS[m]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* --- price comparison: two prices, saving derived --- */}
            {state.discount_mode === "comparison" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pf-old-price" className={labelClass}>
                      Old price
                    </label>
                    <input
                      id="pf-old-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={state.regular_price || ""}
                      onChange={(e) => set("regular_price", parseFloat(e.target.value) || 0)}
                      className={inputClass}
                      placeholder="4500"
                    />
                  </div>
                  <div>
                    <label htmlFor="pf-new-price" className={labelClass}>
                      New price
                    </label>
                    <input
                      id="pf-new-price"
                      type="number"
                      min={0}
                      step="0.01"
                      value={state.comparison_price || ""}
                      onChange={(e) => set("comparison_price", parseFloat(e.target.value) || 0)}
                      className={inputClass}
                      placeholder="3500"
                    />
                  </div>
                </div>
                {/*
                  The visual comparison. The struck-through old price beside the
                  new one is what a shopper is shown on a product card, so it is
                  shown here too -- an admin should be approving the same
                  comparison the storefront will render, not a table of inputs.

                  The saving is the DIFFERENCE and the percentage, rather than
                  only the percentage: a percentage is the harder of the two to
                  judge against a price, and 15% of 700 is not obviously 105.
                */}
                {state.regular_price > 0 && state.comparison_price > 0 && (
                  <div className="flex flex-wrap items-center gap-3 bg-surface-subtle rounded-lg px-3 py-2.5">
                    <span className="line-through text-text-muted">
                      {formatTaka(state.regular_price)}
                    </span>
                    <span className="text-text-muted" aria-hidden>
                      &rarr;
                    </span>
                    <span className="font-display text-base font-semibold text-primary">
                      {formatTaka(state.comparison_price)}
                    </span>
                    {derived.hasDiscount && (
                      <>
                        <span className="text-[11px] text-text-muted">
                          Save {formatTaka(state.regular_price - derived.sale)} ({derived.percent}% off)
                        </span>
                        {/*
                          Two things can differ between what was typed and what
                          will be stored, and the admin is told about both rather
                          than discovering either on the storefront.

                          The PRICE, when a two-decimal percentage cannot express
                          the pair exactly: 349.99 off 400 is 12.5025%, stored as
                          12.50%, and 12.50% of 400 is 350.00. The stored price is
                          deliberately the one the percentage produces, because
                          get_effective_prices() recomputes the price from the
                          percentage at read time -- storing the typed figure
                          instead would show one price on a product card and
                          charge another at checkout. Every pair a shop actually
                          uses (1000 to 850, 400 to 350) is exact; this only
                          bites on an odd paisa.

                          The PERCENTAGE, because the badge rounds to a whole
                          number for display while the stored value keeps its
                          two decimals.
                        */}
                        {derived.sale !== state.comparison_price && (
                          <span className="text-[11px] font-semibold text-primary">
                            Stores as {formatTaka(derived.sale)} — the nearest price a{" "}
                            {discount.value}% discount gives.
                          </span>
                        )}
                        {derived.percent !== discount.value && (
                          <span className="text-[11px] text-text-muted">
                            Stored as {discount.value}% and shown rounded to {derived.percent}%.
                          </span>
                        )}
                      </>
                    )}
                    {!derived.hasDiscount && state.comparison_price >= state.regular_price && (
                      <span className="text-[11px] text-text-muted">
                        The new price is not below the old one, so this is not a discount.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* --- custom: manual amount or percentage --- */}
            {state.discount_mode === "custom" && (
              <div className="space-y-3">
                <div className="flex gap-2 max-w-sm">
                  <div className="w-40">
                    <select
                      aria-label="Discount type"
                      value={state.discount_type}
                      onChange={(e) => set("discount_type", e.target.value as DiscountType)}
                      className={fieldClass}
                    >
                      <option value="percentage">Percentage off</option>
                      <option value="flat">Amount off (৳)</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    aria-label="Discount value"
                    value={state.discount_value || ""}
                    onChange={(e) => set("discount_value", parseFloat(e.target.value) || 0)}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
                {/*
                  A flat amount stores no percentage, so one is worked out from
                  the two prices. It is shown because "150 off" and "21% off" are
                  the same markdown and an admin choosing between them needs to
                  see that they are.
                */}
                {derived.hasDiscount && (
                  <div className="flex flex-wrap items-center gap-3 bg-surface-subtle rounded-lg px-3 py-2.5">
                    <span className="line-through text-text-muted">
                      {formatTaka(state.regular_price)}
                    </span>
                    <span className="text-text-muted" aria-hidden>
                      &rarr;
                    </span>
                    <span className="font-display text-base font-semibold text-primary">
                      {formatTaka(derived.sale)}
                    </span>
                    <span className="text-[11px] text-text-muted">
                      Save {formatTaka(state.regular_price - derived.sale)} ({derived.percent}% off)
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* --- promotion: the discount comes from Promotions --- */}
            {state.discount_mode === "promotion" && (
              <div>
                <p className={labelClass} id="pf-promotions">
                  Promotions
                </p>
                {promotionsLoading ? (
                  <div className={inputClass + " bg-surface-subtle animate-pulse"} aria-hidden />
                ) : promotions.length === 0 ? (
                  <p className="text-[11px] text-text-muted">
                    No promotions exist yet. Create one under{" "}
                    <a href="/admin/promotions" className="text-primary font-medium">
                      Promotions
                    </a>
                    , or switch to a custom discount to price this product directly.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="pf-promotions">
                    {promotions.map((promo) => {
                      const on = state.promotionIds.includes(promo.id);
                      const live =
                        promo.status === "active" &&
                        new Date(promo.starts_at) <= new Date() &&
                        new Date(promo.ends_at) > new Date();
                      return (
                        <button
                          type="button"
                          key={promo.id}
                          aria-pressed={on}
                          onClick={() => dispatch({ type: "togglePromotion", id: promo.id })}
                          className={`${chipClass} ${
                            on
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "text-text-muted hover:border-primary/40"
                          }`}
                        >
                          {promo.name}
                          <span className="text-[10px] opacity-70">
                            {promo.discount_type === "percentage"
                              ? `${Math.round(Number(promo.discount_value))}%`
                              : `৳${Number(promo.discount_value)}`}
                          </span>
                          {/* A linked but not-yet-live promotion is the normal
                              state for a scheduled campaign, so it is labelled
                              rather than hidden -- an admin who cannot tell a
                              scheduled promotion from a broken one cannot use
                              the feature. */}
                          {!live && (
                            <span className="text-[10px] opacity-60">scheduled</span>
                          )}
                          {on && <Check className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-text-muted">
                  The promotion applies while its dates are live, and supplies the badge. A
                  promotion that would raise the price is ignored, and a coupon is applied on top of
                  the lower of the two.
                </p>
              </div>
            )}

            {/* --- the generated badge --- */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border-light">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Badge
              </span>
              {badgePreview ? (
                <>
                  {/* Rendered with the real badge styling, not described in
                      words: badgeClass is what the storefront calls, so the
                      colour here is the colour there. */}
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${badgeClass(badgePreview.type)}`}
                  >
                    {badgePreview.label}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Generated from the discount
                    {badgePreview.source ? ` by the “${badgePreview.source}” promotion` : ""}. It
                    cannot be typed over, so it cannot contradict the price.
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-text-muted">
                  No badge. One is generated as soon as there is a discount
                  {state.discount_mode === "promotion" && state.promotionIds.length === 0
                    ? " and a promotion is chosen"
                    : ""}
                  .
                </span>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="pf-description" className={labelClass}>
              Description
            </label>
            <RichTextEditor
              value={state.description}
              onChange={(html) => set("description", html)}
              onSanitised={() =>
                setFormError("Some formatting was removed because it is not allowed in a description.")
              }
            />
          </div>

          {isEdit && product?.id ? (
            <ProductMediaManager productId={product.id} />
          ) : (
            <div>
              <p className={labelClass}>Product images</p>
              <p className="text-[11px] text-text-muted bg-surface-subtle rounded-lg px-3 py-2.5">
                Save the product first, then reopen it to upload images. Media is stored under this
                product&rsquo;s own folder, so it needs an id to attach to.
              </p>
            </div>
          )}

          {/* Colours and sizes: two multi-selects, then the matrix they define. */}
          <div className="space-y-2">
            <p className={labelClass}>Options</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <fieldset>
                <legend className="text-xs text-text-muted mb-1.5">Colours</legend>
                {colorsLoading ? (
                  <div className={inputClass + " bg-surface-subtle animate-pulse"} aria-hidden />
                ) : colors.length === 0 ? (
                  <p className="text-[11px] text-text-muted">
                    No colours yet. Create them under{" "}
                    <a href="/admin/colors" className="text-primary font-medium">
                      Color Palette
                    </a>
                    .
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colours">
                    {colors.map((color) => {
                      const on = state.colorIds.includes(color.id);
                      return (
                        <button
                          type="button"
                          key={color.id}
                          aria-pressed={on}
                          onClick={() => dispatch({ type: "toggleColor", id: color.id })}
                          className={`${chipClass} ${
                            on
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "text-text-muted hover:border-primary/40"
                          }`}
                        >
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-border-light"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name}
                          {on && <Check className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              <fieldset>
                <legend className="text-xs text-text-muted mb-1.5">Sizes</legend>
                {sizesLoading ? (
                  <div className={inputClass + " bg-surface-subtle animate-pulse"} aria-hidden />
                ) : sizes.length === 0 ? (
                  <p className="text-[11px] text-text-muted">
                    No sizes yet. Create them under{" "}
                    <a href="/admin/sizes" className="text-primary font-medium">
                      Sizes
                    </a>
                    .
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sizes">
                    {sizes.map((size) => {
                      const on = state.sizeIds.includes(size.id);
                      return (
                        <button
                          type="button"
                          key={size.id}
                          aria-pressed={on}
                          onClick={() => dispatch({ type: "toggleSize", id: size.id })}
                          className={`${chipClass} ${
                            on
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "text-text-muted hover:border-primary/40"
                          }`}
                        >
                          {size.display_name || size.name}
                          {size.type && size.type !== "all" && (
                            <span className="text-[10px] uppercase tracking-wider opacity-70">{size.type}</span>
                          )}
                          {on && <Check className="w-3 h-3" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            </div>
          </div>

          <div>
            <p className={labelClass}>Variants</p>
            <VariantMatrix
              colors={chosenColors}
              sizes={chosenSizes}
              state={state.matrix}
              onChange={(matrix) => dispatch({ type: "matrix", value: matrix })}
              disabled={submitting}
            />
          </div>

          <div>
            <p className={labelClass}>Specs</p>
            <div className="space-y-2">
              {state.specs.length === 0 && (
                <p className="text-[11px] text-text-muted">
                  No specs. Add a row for a material, a weight, or a fit note.
                </p>
              )}
              {state.specs.map((spec, i) => (
                <div key={spec.uid} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={spec.key}
                    placeholder="Fabric"
                    aria-label={`Spec ${i + 1} name`}
                    onChange={(e) => dispatch({ type: "specKey", index: i, value: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={spec.value}
                    placeholder="100% Cotton"
                    aria-label={`Spec ${i + 1} value`}
                    onChange={(e) => dispatch({ type: "specValue", index: i, value: e.target.value })}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "removeSpec", index: i })}
                    aria-label={`Remove spec ${i + 1}`}
                    className="p-2 text-text-muted hover:text-badge-discount rounded transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => dispatch({ type: "addSpec" })}
                className="px-3 py-1.5 text-xs font-semibold text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
              >
                Add spec
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="pf-featured"
              checked={state.is_featured}
              onChange={(e) => set("is_featured", e.target.checked)}
            />
            <label htmlFor="pf-featured" className="text-sm text-on-surface">
              Featured product
            </label>
          </div>
        </div>

        <div className="p-6 border-t border-border-light flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border-light rounded-lg text-sm font-semibold text-text-muted hover:bg-surface-subtle transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary-container transition-colors disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
