import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { full_name, phone, address, city } = body;

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
    return NextResponse.json({ error: "Authentication service not configured" }, { status: 500 });
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        full_name,
        phone,
        address,
        city,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
