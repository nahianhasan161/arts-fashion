import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/account";
  const origin = url.origin;

  if (!code) {
    const redirectUrl = new URL("/sign-in", origin);
    redirectUrl.searchParams.set("error", "Authorization code not found");
    return NextResponse.redirect(redirectUrl.toString());
  }

  // Build the redirect response early so Supabase can attach session cookies to it.
  const redirectPath = getSafeRedirectPath(next, origin);
  const response = NextResponse.redirect(new URL(redirectPath, origin));
  const cookieStore = cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          ),
      },
    },
  );

  if (!supabase) {
    const redirectUrl = new URL("/sign-in", origin);
    redirectUrl.searchParams.set("error", "Authentication service not configured");
    return NextResponse.redirect(redirectUrl.toString());
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Exchange code error:", error);
    const redirectUrl = new URL("/sign-in", origin);
    redirectUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(redirectUrl.toString());
  }

  return response;
}
