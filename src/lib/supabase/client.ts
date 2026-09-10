import { createBrowserClient } from "@supabase/ssr";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
  
    if (typeof window === "undefined") {
    return createClient(supabaseUrl, supabasePublishableKey);
  }

  if (!cachedBrowserClient) {
    cachedBrowserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  }
  return cachedBrowserClient;
}

export const supabase = isSupabaseConfigured
  ? (typeof window !== "undefined" ? getSupabaseBrowserClient() : createClient(supabaseUrl, supabasePublishableKey))
  : null;
