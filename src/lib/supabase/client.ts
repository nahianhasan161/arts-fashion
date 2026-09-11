import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabasePublishableKey &&
  !supabaseUrl.includes("your-project") &&
  supabaseUrl.startsWith("http")
);

let cachedBrowserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;

  // Always use createBrowserClient from @supabase/ssr on the client side.
  // This ensures PKCE code verifier is stored in cookies consistently,
  // which is required for Next.js SSR frameworks.
  if (typeof window === "undefined") return null;

  if (!cachedBrowserClient) {
    cachedBrowserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  }
  return cachedBrowserClient;
}

// Module-level export: only available on the client side.
// Server-side code should use getSupabaseServerClient() from @/lib/supabase/server
export const supabase = isSupabaseConfigured && typeof window !== "undefined"
  ? getSupabaseBrowserClient()
  : null;
