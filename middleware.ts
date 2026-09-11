import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createSupabaseServerClient({
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet, headers) => {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      Object.entries(headers ?? {}).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    },
  });

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isProtectedRoute =
      request.nextUrl.pathname === "/account" ||
      request.nextUrl.pathname.startsWith("/account/") ||
      request.nextUrl.pathname === "/admin" ||
      request.nextUrl.pathname.startsWith("/admin/");

    if (!user && isProtectedRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/sign-in";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    const isAdminRoute =
      request.nextUrl.pathname === "/admin" ||
      request.nextUrl.pathname.startsWith("/admin/");

    if (user && isAdminRoute) {
      const { data: isAdminResult, error: adminCheckError } =
        await supabase.rpc("is_admin");

      if (adminCheckError || !isAdminResult) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
