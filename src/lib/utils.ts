export { cn } from "cn"

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
