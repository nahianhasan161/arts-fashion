import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function getSupabase() {
  return getSupabaseServerClient();
}

/**
 * GET /api/returns
 * Returns the current user's own return requests.
 * Authenticated users only.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("returns")
      .select(
        `
        id,
        order_id,
        reason,
        status,
        refund_amount,
        notes,
        created_at,
        updated_at,
        return_items (
          id,
          order_item_id,
          quantity,
          condition_at_return
        )
        `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/returns
 * Create a return request for one of the current user's orders.
 * Authenticated users only.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { order_id, reason, items, notes } = body;

    if (!order_id || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "order_id and at least one return item are required" },
        { status: 400 }
      );
    }

    // Verify the order belongs to this user
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, user_id")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Create the return record
    const { data: returnRecord, error: returnError } = await supabase
      .from("returns")
      .insert({
        order_id,
        user_id: user.id,
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
    const returnItems = items.map(
      (item: { order_item_id: string; quantity: number; condition_at_return?: string }) => ({
        return_id: returnRecord.id,
        order_item_id: item.order_item_id,
        quantity: item.quantity,
        condition_at_return: item.condition_at_return || null,
      })
    );

    const { data: itemsData, error: itemsError } = await supabase
      .from("return_items")
      .insert(returnItems)
      .select();

    if (itemsError) {
      await supabase.from("returns").delete().eq("id", returnRecord.id);
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json(
      { data: { ...returnRecord, return_items: itemsData } },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}