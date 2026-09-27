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
import type {
  Category,
  ColorOption,
  Product,
  ProductStatus,
  Promotion,
  SizeOption,
} from "@/types";

const badgeTypeOptions: { value: string; label: string }[] = [
  { value: "discount", label: "Discount" },
  { value: "new", label: "New" },
  { value: "festive", label: "Festive" },
  { value: "popular", label: "Popular" },
];

const statusOptions: { value: ProductStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

type DiscountType = "percentage" | "flat";

/**
 * The sale price the server will store, mirrored here for display only.
 *
 * This duplicates calculate_sale_price so the admin can see the result of the
 * discount while typing it. It is never sent: the server derives the same
 * figure from regular_price and the discount, and a client-computed price in a
 * payload is precisely what the server-authoritative design exists to
 * prevent. If the two ever disagree, the server's value is the one that counts
 * and this is the number that was wrong.
 */
function previewSalePrice(regular: number, type: DiscountType, value: number): number {
  if (!(regular > 0) || !(value > 0)) return regular;
  const sale = type === "percentage" ? regular - (regular * value) / 100 : regular - value;
  // A flat discount larger than the price is refused by the server, so the
  // preview is clamped to keep the number on screen from ever showing a
  // negative price the save would reject anyway.
  return Math.max(0, sale);
}

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
interface FormState {
  title: string;
  slug: string;
  categoryId: string;
  subCategoryId: string;
  description: string;
  /** Pre-discount price. Sends regular_price. */
  regular_price: number;
  discount_type: DiscountType;
  /** Sends discount_value. A percentage, or a flat amount off. */
  discount_value: number;
  stock: number;
  badge: string;
  badge_type: string;
  is_featured: boolean;
  status: ProductStatus;
  specs: { key: string; value: string }[];
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
    discount_type: "percentage",
    discount_value: 0,
    stock: 0,
    badge: "",
    badge_type: "",
    is_featured: false,
    status: "draft",
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

  const byKey = new Map((product.variants ?? []).map((v) => [v.variant_key, v]));

  if (colorIds.length > 0 && sizeIds.length > 0) {
    for (const c of colorIds) {
      for (const s of sizeIds) {
        const v = byKey.get(`${c}:${s}`);
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
      const v = byKey.get(`${c}:-`);
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
      const v = byKey.get(`-:${s}`);
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
      return { ...state, specs: [...state.specs, { key: "", value: "" }] };

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
      discount_type: (p.discount_type ?? "percentage") as DiscountType,
      discount_value: Number(p.discount_value ?? 0),
      stock: Number(p.stock ?? 0),
      badge: p.badge ?? "",
      badge_type: p.badge_type ?? "",
      is_featured: p.is_featured ?? false,
      status: p.status ?? "draft",
      specs: Object.entries(p.specs ?? {}).map(([key, value]) => ({ key, value: String(value) })),
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
      discount_type: state.discount_type,
      discount_value: state.discount_value,
      stock: state.stock,
      badge: state.badge || null,
      badge_type: state.badge_type || null,
      is_featured: state.is_featured,
      status: state.status,
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
    const unnamedSpec = state.specs.some((s) => !s.key.trim() && s.value.trim());
    if (unnamedSpec) {
      setFormError("Every spec needs a name, or the value has nowhere to go.");
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-border-light flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-primary">
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
                  Shoppers pay{" "}
                  <span className="font-semibold text-on-surface">
                    ৳{" "}
                    {previewSalePrice(
                      state.regular_price,
                      state.discount_type,
                      state.discount_value,
                    ).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  {previewSalePrice(state.regular_price, state.discount_type, state.discount_value) <
                  state.regular_price && (
                    <>
                      , reduced from{" "}
                      <span className="line-through">
                        ৳ {state.regular_price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </>
                  )}
                  . The storefront price is worked out on the server.
                </p>
              )}
            </div>

            <div>
              <span className={labelClass}>Discount</span>
              <div className="flex gap-2">
                <div className="w-32">
                  <select
                    aria-label="Discount type"
                    value={state.discount_type}
                    onChange={(e) => set("discount_type", e.target.value as DiscountType)}
                    className={fieldClass}
                  >
                    <option value="percentage">Percentage</option>
                    <option value="flat">Flat amount</option>
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
              <p className="mt-1 text-[11px] text-text-muted">
                {state.discount_type === "percentage"
                  ? "Taken off the price as a percentage."
                  : "Taken off the price as an amount in taka."}
              </p>
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
                  This is the total across every variant. Set each figure in the matrix below.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="pf-badge" className={labelClass}>
                Badge
              </label>
              <input
                id="pf-badge"
                type="text"
                value={state.badge}
                onChange={(e) => set("badge", e.target.value)}
                className={inputClass}
              />
            </div>

            <Dropdown
              id="pf-badgetype"
              label="Badge Type"
              value={state.badge_type}
              onChange={(v) => set("badge_type", v)}
            >
              <option value="">None</option>
              {badgeTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Dropdown>
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
            <label htmlFor="pf-promotions" className={labelClass}>
              Promotions
            </label>
            {promotionsLoading ? (
              <div className={inputClass + " bg-surface-subtle animate-pulse"} aria-hidden />
            ) : promotions.length === 0 ? (
              <p className="text-[11px] text-text-muted">
                No promotions exist yet. Create them under{" "}
                <a href="/admin/promotions" className="text-primary font-medium">
                  Promotions
                </a>
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="pf-promotions">
                {promotions.map((promo) => {
                  const on = state.promotionIds.includes(promo.id);
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
                          ? `${promo.discount_value}%`
                          : `৳${promo.discount_value}`}
                      </span>
                      {on && <Check className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-[11px] text-text-muted">
              A promotion is applied to this product when its dates are live. A promotion that would
              raise the price is ignored, and a coupon is applied on top of the lower of the two.
            </p>
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
                <div key={i} className="flex items-center gap-2">
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
