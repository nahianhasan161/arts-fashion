import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=Authorization code not found`);
  }

  const cookieStore = cookies();
  const supabase = createSupabaseServerClient({
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

  if (!supabase) {
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=Authentication service not configured`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Exchange code error:", error);
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  const redirectUrl = new URL(next || "/account", requestUrl.origin);
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");

  redirectUrl.host = forwardedHost || redirectUrl.host;

  const response = NextResponse.redirect(redirectUrl.toString());

  return response;
}
