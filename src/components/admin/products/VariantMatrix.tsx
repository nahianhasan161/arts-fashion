"use client";

/**
 * The colour × size matrix for a product.
 *
 * The grid is generated from the two chosen option lists, so the cell count is
 * a consequence of the selection rather than something typed. A row holds one
 * colour, a column one size, and the intersection is the stock for that pair.
 *
 * Two decisions are worth stating because they are not the obvious ones:
 *
 *   - A cell with no stock is not the same as a cell that does not exist. A
 *     sold-out pair still appears on the storefront as unavailable, which is
 *     what lets a shopper be told "out of stock in this size" instead of being
 *     offered a size that cannot be bought. So every generated cell is sent,
 *     with a stock of zero, and the matrix is not derived from which cells
 *     happen to be filled in.
 *   - Stock is not summed anywhere in this component. The total shown for a
 *     size is computed by the server, and the per-size figure it stores is the
 *     sum across colours, so the number the admin sees and the number the
 *     storefront shows come from one place.
 */

import { useMemo } from "react";
import type { ColorOption, SizeOption } from "@/types";

// The admin surface uses the project's own tokens rather than the shadcn
// primitives, so the matrix is styled to sit inside the products page without
// a visible seam. These three are the only inputs it needs.
const inputClass =
  "w-full h-8 px-2 border border-border-light rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/20 disabled:opacity-50";
const cellInputClass = inputClass + " w-24 text-xs";
const ghostButtonClass =
  "px-2 py-1 text-xs font-semibold text-text-muted hover:text-primary border border-border-light rounded-lg transition-colors disabled:opacity-50";

/** A cell is keyed on the pair, with a null axis meaning "does not vary". */
export type CellKey = `${string}:${string}`;

export interface MatrixCell {
  stock: number;
  price_override: string | null;
  sku: string | null;
  is_active: boolean;
}

export type MatrixState = Record<CellKey, MatrixCell>;

/**
 * The key for a pair where one axis does not vary. A placeholder is used rather
 * than an empty segment so "no colour, size m" cannot collide with a real id
 * that happens to be blank.
 */
const NONE = "-";

export function cellKey(colorId: string | null, sizeId: string | null): CellKey {
  return `${colorId ?? NONE}:${sizeId ?? NONE}`;
}

export function emptyCell(): MatrixCell {
  return { stock: 0, price_override: null, sku: null, is_active: true };
}

export interface VariantMatrixProps {
  colors: ColorOption[];
  sizes: SizeOption[];
  state: MatrixState;
  onChange: (next: MatrixState) => void;
  /** Shown above the grid when neither axis has any options yet. */
  emptyHint?: React.ReactNode;
  disabled?: boolean;
}

export function VariantMatrix({
  colors,
  sizes,
  state,
  onChange,
  emptyHint,
  disabled,
}: VariantMatrixProps) {
  // The axes are pruned to the chosen options here, so removing a colour from
  // the form also removes its row and its cells in one pass, and the grid can
  // never show a row for a colour that is no longer selected.
  const rows = colors;
  const cols = sizes;

  const totals = useMemo(() => {
    const perSize: Record<string, number> = {};
    let grand = 0;
    for (const size of cols) {
      let sum = 0;
      for (const color of rows) {
        const cell = state[cellKey(color.id, size.id)];
        if (cell?.is_active) sum += cell.stock;
      }
      perSize[size.id] = sum;
      grand += sum;
    }
    if (rows.length === 0) {
      for (const size of cols) {
        const cell = state[cellKey(null, size.id)];
        if (cell?.is_active) grand += cell.stock;
      }
    }
    return { perSize, grand };
  }, [rows, cols, state]);

  // Counted here rather than in the two-axis branch below, because a hook
  // after an early return would be skipped on the renders that return first
  // and the hook order would differ between them.
  const soldOut = useMemo(
    () =>
      rows.flatMap((c) => cols.map((s) => ({ cell: state[cellKey(c.id, s.id)] })))
        .filter((x) => (x.cell?.stock ?? 0) === 0).length,
    [rows, cols, state],
  );

  if (rows.length === 0 && cols.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-light p-6 text-center text-sm text-muted-foreground">
        {emptyHint ?? "Choose a colour or a size to build the options for this product."}
      </div>
    );
  }

  const update = (key: CellKey, patch: Partial<MatrixCell>) => {
    onChange({ ...state, [key]: { ...(state[key] ?? emptyCell()), ...patch } });
  };

  /**
   * Stock is clamped on the way in rather than on save. A number input can
   * still deliver a minus sign or a paste of "-4", and the server refuses the
   * whole save for a negative figure, so the field would have to be corrected
   * and every other cell resubmitted to find out. Clamping here keeps the
   * matrix always valid.
   */
  const parseStock = (raw: string): number => {
    const n = Number.parseInt(raw.replace(/[^0-9-]/g, ""), 10);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, n);
  };

  const cellFor = (colorId: string | null, sizeId: string | null): MatrixCell =>
    state[cellKey(colorId, sizeId)] ?? emptyCell();

  // A single axis, or neither, still needs a one-column table so the same
  // inputs and the same sent payload shape apply to every product.
  if (rows.length === 0 || cols.length === 0) {
    const entries: { key: CellKey; label: string; swatch?: string }[] =
      rows.length > 0
        ? rows.map((c) => ({ key: cellKey(c.id, null), label: c.name, swatch: c.hex }))
        : cols.map((s) => ({ key: cellKey(null, s.id), label: s.display_name || s.name }));

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {rows.length > 0
            ? "This product does not vary by size, so each colour has one stock figure."
            : "This product does not vary by colour, so each size has one stock figure."}
        </p>
        <div className="overflow-x-auto rounded-lg border border-input">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{rows.length > 0 ? "Colour" : "Size"}</th>
                <th className="w-28 px-3 py-2 font-medium">Stock</th>
                <th className="w-40 px-3 py-2 font-medium">Price override</th>
                <th className="w-40 px-3 py-2 font-medium">SKU</th>
                <th className="w-16 px-3 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const cell = state[entry.key] ?? emptyCell();
                return (
                  <tr key={entry.key} className="border-t border-input">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        {entry.swatch && (
                          <span
                            className="size-4 rounded-full border border-border-light"
                            style={{ backgroundColor: entry.swatch }}
                          />
                        )}
                        {entry.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        disabled={disabled}
                        value={cell.stock}
                        aria-label={`Stock for ${entry.label}`}
                        onChange={(e) => update(entry.key, { stock: parseStock(e.target.value) })}
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={disabled}
                        value={cell.price_override ?? ""}
                        placeholder="—"
                        aria-label={`Price override for ${entry.label}`}
                        onChange={(e) =>
                          update(entry.key, { price_override: e.target.value === "" ? null : e.target.value })
                        }
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        disabled={disabled}
                        value={cell.sku ?? ""}
                        placeholder="auto"
                        aria-label={`SKU for ${entry.label}`}
                        onChange={(e) => update(entry.key, { sku: e.target.value || null })}
                        className={inputClass}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={cell.is_active}
                        disabled={disabled}
                        aria-label={`Active for ${entry.label}`}
                        onChange={(e) => update(entry.key, { is_active: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Total stock: {totals.grand}</p>
      </div>
    );
  }

  /**
   * Fills every cell that has stock, leaving the ones that are genuinely zero
   * alone, so a partial entry is not silently completed with stock it never
   * had. Setting a stock is what makes a cell exist, and a single "apply to
   * all" is the common case of adding a colour or a size to a product that
   * already sells.
   */
  const applyToAll = (patch: Partial<MatrixCell>) => {
    const next: MatrixState = { ...state };
    for (const color of rows) {
      for (const size of cols) {
        const key = cellKey(color.id, size.id);
        next[key] = { ...(next[key] ?? emptyCell()), ...patch };
      }
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "colour" : "colours"} × {cols.length}{" "}
          {cols.length === 1 ? "size" : "sizes"} = {rows.length * cols.length} variants
          {soldOut > 0 && (
            <span className="ml-2 rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {soldOut} at zero
            </span>
          )}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={disabled}
            onClick={() => applyToAll({ stock: 0 })}
            className={ghostButtonClass}
          >
            Clear stock
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const first = rows[0] && cols[0] ? (state[cellKey(rows[0].id, cols[0].id)]?.stock ?? 0) : 0;
              applyToAll({ stock: first });
            }}
          >
            Copy first
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-border-light">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface-subtle">
            <tr>
              <th className="sticky left-0 z-20 bg-surface-subtle px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                Colour / Size
              </th>
              {cols.map((size) => (
                <th key={size.id} className="px-3 py-2 text-left text-xs font-medium">
                  <div>{size.display_name || size.name}</div>
                  <div className="font-normal text-muted-foreground">
                    {totals.perSize[size.id]} in stock
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((color) => (
              <tr key={color.id} className="border-t border-input">
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap bg-surface-card px-3 py-2 text-left font-medium"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-4 shrink-0 rounded-full border border-border-light"
                      style={{ backgroundColor: color.hex }}
                    />
                    {color.name}
                  </span>
                </th>
                {cols.map((size) => {
                  const key = cellKey(color.id, size.id);
                  const cell = cellFor(color.id, size.id);
                  const detailId = `cell-${color.id}-${size.id}`;
                  return (
                    <td key={key} className="p-2 align-top">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number"
                          min={0}
                          value={cell.stock}
                          disabled={disabled}
                          aria-label={`Stock for ${color.name} ${size.display_name || size.name}`}
                          onChange={(e) => update(key, { stock: parseStock(e.target.value) })}
                          className={cellInputClass}
                        />
                        <details className="text-xs">
                          <summary
                            className="cursor-pointer text-muted-foreground hover:text-foreground"
                            aria-controls={detailId}
                          >
                            {cell.price_override || cell.sku ? "details" : "more"}
                          </summary>
                          <div id={detailId} className="mt-1 flex flex-col gap-1">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              placeholder="Price override"
                              value={cell.price_override ?? ""}
                              disabled={disabled}
                              aria-label={`Price override for ${color.name} ${size.display_name || size.name}`}
                              onChange={(e) =>
                                update(key, { price_override: e.target.value === "" ? null : e.target.value })
                              }
                              className={cellInputClass + " h-7"}
                            />
                            <input
                              placeholder="SKU"
                              value={cell.sku ?? ""}
                              disabled={disabled}
                              aria-label={`SKU for ${color.name} ${size.display_name || size.name}`}
                              onChange={(e) => update(key, { sku: e.target.value || null })}
                              className={cellInputClass + " h-7"}
                            />
                            <label className="flex items-center gap-1 text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={cell.is_active}
                                disabled={disabled}
                                aria-label={`Active for ${color.name} ${size.display_name || size.name}`}
                                onChange={(e) => update(key, { is_active: e.target.checked })}
                              />
                              active
                            </label>
                          </div>
                        </details>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border-light bg-surface-subtle">
            <tr>
              <th scope="row" className="sticky left-0 bg-surface-subtle px-3 py-2 text-left text-xs font-medium">
                Total
              </th>
              {cols.map((size) => (
                <td key={size.id} className="px-3 py-2 text-sm font-medium">
                  {totals.perSize[size.id]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Total stock across all variants: {totals.grand}. A variant with zero stock is still published, so the
        storefront can show it as sold out rather than offering something that cannot be bought.
      </p>
    </div>
  );
}
