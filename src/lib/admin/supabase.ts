import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Supabase client bound to the incoming request cookies, for admin API routes.
 * Extracted so each admin route does not repeat the cookie adapter.
 */
export function getAdminSupabase() {
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
