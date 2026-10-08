import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";

async function getSupabase() {
  return getSupabaseServerClient();
}

/**
 * GET /api/admin/payments
 * Returns all payments, optionally filtered by order_id or status.
 * Admin-only.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const url = new URL(request.url);
    const orderId = url.searchParams.get("order_id");
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const provider = url.searchParams.get("provider");

    let query = supabase
      .from("payments")
      .select(
        `
        id,
        order_id,
        user_id,
        type,
        provider,
        provider_txn_id,
        amount,
        status,
        metadata,
        created_at,
        updated_at,
        orders!inner (customer_name, total_amount, payment_method)
        `
      )
      .order("created_at", { ascending: false });

    if (orderId) query = query.eq("order_id", orderId);
    if (status) query = query.eq("status", status);
    if (type) query = query.eq("type", type);
    if (provider) query = query.eq("provider", provider);

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleAdminError(error);
  }
}

/**
 * POST /api/admin/payments
 * Create a new payment transaction (charge or refund).
 * Admin-only. Used for manual COD payment recording and future MFS refunds.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { order_id, type, provider, amount, provider_txn_id, status, metadata } = body;

    if (!order_id || !type || !amount) {
      return NextResponse.json(
        { error: "order_id, type, and amount are required" },
        { status: 400 }
      );
    }

    const validTypes = ["charge", "refund", "chargeback"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        order_id,
        type,
        provider: provider || "cod",
        amount: Number(amount),
        provider_txn_id: provider_txn_id || null,
        status: status || "initiated",
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleAdminError(error);
  }
}

/**
 * PATCH /api/admin/payments
 * Update a payment's status (e.g. mark COD charge as successful, or
 * mark a refund as completed). Admin-only.
 */
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
  } catch (error) {
    return handleAdminError(error);
  }

  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const body = await request.json();
    const { id, status, provider_txn_id, metadata } = body;

    if (!id) {
      return NextResponse.json({ error: "Payment id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (provider_txn_id !== undefined) updates.provider_txn_id = provider_txn_id;
    if (metadata !== undefined) updates.metadata = metadata;

    const { data, error } = await supabase
      .from("payments")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return handleAdminError(error);
  }
}