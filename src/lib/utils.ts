export { cn } from "cn"
import type { Category } from "@/types"

/**
 * Converts a string to a URL-friendly slug.
 * - Lowercases the string
 * - Normalizes special characters (e.g., accented chars -> base ASCII)
 * - Replaces spaces, underscores, and special characters with hyphens
 * - Collapses multiple consecutive hyphens into one
 * - Removes leading/trailing hyphens
 * - Returns empty string for empty/null/undefined input
 */
export function slugify(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .toLowerCase()
    .normalize("NFD") // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric, keep spaces and hyphens
    .replace(/[\s_-]+/g, "-") // Replace spaces, underscores with single hyphen
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // Trim leading/trailing hyphens
}

/**
 * Flattens the category tree into a single list, parents before children.
 *
 * `GET /api/admin/categories` returns a TREE: the top-level array holds only
 * the roots, and every sub-category is nested inside its parent's `children`
 * key. That is the right shape for rendering a nested category manager, and
 * the wrong shape for anything that selects a category and then needs to look
 * up that category's sub-categories by `parent_id`.
 *
 * The sub-category dropdown in the product form filters a flat list
 * (`categories.filter(c => c.parent_id === categoryId)`). Handed the raw tree
 * it matches nothing, because every top-level row has `parent_id === null` by
 * construction, and the dropdown reported "This category has no
 * sub-categories" for parents that had one. That was not a false negative
 * about the data; the sub-categories were in the response, just one level down.
 *
 * This lives here so the three admin pages that consume the tree cannot drift
 * apart a fourth time. It previously existed as two identical local copies in
 * the colors and sizes pages, and the products page was the one that forgot.
 *
 * Recurses rather than assuming a single level: buildTree() has no depth
 * guard, and a third level would otherwise be silently dropped.
 */
export function flattenCategoryTree(nodes: Category[]): Category[] {
  return nodes.flatMap((node) => [node, ...flattenCategoryTree(node.children ?? [])]);
}
