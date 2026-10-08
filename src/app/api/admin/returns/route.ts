import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin, handleAdminError } from "@/lib/admin/auth";

async function getSupabase() {
  return getSupabaseServerClient();
}

/**
 * GET /api/admin/returns
 * Returns all returns with their items. Admin-only.
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
    const status = url.searchParams.get("status");
    const orderId = url.searchParams.get("order_id");

    let query = supabase
      .from("returns")
      .select(
        `
        id,
        order_id,
        user_id,
        reason,
        status,
        refund_amount,
        refund_payment_id,
        notes,
        created_at,
        updated_at,
        return_items (
          id,
          order_item_id,
          quantity,
          condition_at_return
        ),
        orders!inner (customer_name, total_amount)
        `
      )
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (orderId) query = query.eq("order_id", orderId);

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
 * POST /api/admin/returns
 * Create a new return request. Can be called by admin (on behalf of
 * customer) or by the customer themselves (via a separate route).
 * Admin-only for now.
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
    const { order_id, reason, items, notes } = body;

    if (!order_id || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "order_id and at least one return item are required" },
        { status: 400 }
      );
    }

    // Create the return record
    const { data: returnRecord, error: returnError } = await supabase
      .from("returns")
      .insert({
        order_id,
        reason: reason || null,
        notes: notes || null,
        status: "requested",
      })
      .select()
      .single();

    if (returnError) {
      return NextResponse.json({ error: returnError.message }, { status: 500 });
    }

    // Create return items
    const returnItems = items.map((item: { order_item_id: string; quantity: number; condition_at_return?: string }) => ({
      return_id: returnRecord.id,
      order_item_id: item.order_item_id,
      quantity: item.quantity,
      condition_at_return: item.condition_at_return || null,
    }));

    const { data: itemsData, error: itemsError } = await supabase
      .from("return_items")
      .insert(returnItems)
      .select();

    if (itemsError) {
      // Rollback the return record if items fail
      await supabase.from("returns").delete().eq("id", returnRecord.id);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json(
      { data: { ...returnRecord, return_items: itemsData } },
      { status: 201 }
    );
  } catch (error) {
    return handleAdminError(error);
  }
}

/**
 * PATCH /api/admin/returns
 * Update a return's status and optionally set the refund payment.
 * Admin-only.
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
    const { id, status, refund_amount, refund_payment_id, notes } = body;

    if (!id) {
      return NextResponse.json({ error: "Return id is required" }, { status: 400 });
    }

    const validStatuses = ["requested", "approved", "received", "completed", "rejected"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (refund_amount !== undefined) updates.refund_amount = Number(refund_amount);
    if (refund_payment_id !== undefined) updates.refund_payment_id = refund_payment_id;
    if (notes !== undefined) updates.notes = notes;

    const { data, error } = await supabase
      .from("returns")
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