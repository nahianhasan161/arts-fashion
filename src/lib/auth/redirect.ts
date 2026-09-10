export function getSafeRedirectPath(
  returnTo: string | null | undefined,
  fallback = "/account"
): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return fallback;
  }

  return returnTo;
}
