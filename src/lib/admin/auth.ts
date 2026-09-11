import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export interface AdminContext {
  user: {
    id: string;
    email?: string;
  };
  profile: Profile | null;
}

export class AdminAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireAdmin(): Promise<AdminContext> {
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
    throw new AdminAuthError(500, "Authentication service not configured");
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new AdminAuthError(401, "Authentication required");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    throw new AdminAuthError(403, "Profile not found");
  }

  if (profile.role !== "admin") {
    throw new AdminAuthError(403, "Admin access required");
  }

  return {
    user: { id: user.id, email: user.email },
    profile: profile as Profile,
  };
}

export function handleAdminError(error: unknown): NextResponse {
  if (error instanceof AdminAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("Unexpected admin error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
