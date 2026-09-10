import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/client";

type CookieEntry = {
  name: string;
  value: string;
};

type CookieStore = {
  getAll: () => CookieEntry[] | null;
  setAll?: (
    cookiesToSet: Array<CookieEntry & { options: CookieOptions }>,
    headers?: Record<string, string>
  ) => void;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export function createSupabaseServerClient(cookieStore: CookieStore): SupabaseClient | null {
  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) return null;

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: cookieStore.getAll,
      setAll: cookieStore.setAll,
    },
  });
}

export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const cookieStore = cookies();

  return createSupabaseServerClient({
    getAll: () => cookieStore.getAll(),
    setAll: (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // Cookie writes are handled by middleware when the runtime makes cookies read-only.
      }
    },
  });
}
