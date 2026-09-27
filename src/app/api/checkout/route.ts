import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CheckoutItemPayload, CheckoutRequest, CheckoutResponse } from "@/types";

/**
 * POST /api/checkout
 *
 * The one place an order is created. The browser used to insert orders
 * and order_items itself, which meant no stock reservation and no
 * server-authoritative pricing; it now calls create_order_with_reservations().
 *
 * This route does three things and nothing else:
 *   1. shape-checks the payload
 *   2. resolves each line to a stock variant (server-side, fails safe)
 *   3. hands the whole thing to the RPC and translates its result
 *
 * It computes no money. Every figure in the response comes back from
 * the database, and the client is expected to render those numbers
 * rather than its own.
 */

/** Coupon/eligibility reason -> HTTP status + customer-facing message. */
const REJECTIONS: Record<string, { status: number; message: string }> = {
  coupon_not_found: { status: 400, message: "That coupon code does not exist." },
  coupon_inactive: { status: 400, message: "That coupon is not active." },
  coupon_not_started: { status: 400, message: "That coupon is not active yet." },
  coupon_expired: { status: 400, message: "That coupon has expired." },
  coupon_login_required: {
    status: 401,
    message: "Sign in to use this coupon code.",
  },
  coupon_wrong_group: {
    status: 403,
    message: "This coupon code is not available for your account.",
  },
  coupon_used_up: { status: 409, message: "This coupon has been fully redeemed." },
  coupon_user_limit_reached: {
    status: 409,
    message: "You have already used this coupon.",
  },
  coupon_min_order: {
    status: 422,
    message: "Your order does not meet the minimum for this coupon.",
  },
  coupon_no_eligible_products: {
    status: 422,
    message: "This coupon does not apply to anything in your bag.",
  },
  empty_order: { status: 400, message: "Your bag is empty." },
  invalid_quantity: { status: 400, message: "An item has an invalid quantity." },
  invalid_shipping_fee: { status: 400, message: "Invalid delivery charge." },
  insufficient_stock: { status: 409, message: "An item just sold out." },
  product_not_found: { status: 422, message: "An item in your bag no longer exists." },
};

function reasonOf(message: string): string {
  // RPC messages are either a bare code or "code:detail".
  const head = message.split(":")[0]?.trim() ?? message;
  return REJECTIONS[head] ? head : message.split(":")[0]?.trim() ?? "unknown";
}

export async function POST(request: Request) {
  let payload: CheckoutRequest;

  try {
    payload = (await request.json()) as CheckoutRequest;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const name = typeof payload?.customer_name === "string" ? payload.customer_name.trim() : "";
  const phone = typeof payload?.customer_phone === "string" ? payload.customer_phone.trim() : "";
  const address = typeof payload?.delivery_address === "string" ? payload.delivery_address.trim() : "";
  const shippingFee = Number(payload?.shipping_fee ?? 0);
  const couponCode = typeof payload?.coupon_code === "string" ? payload.coupon_code.trim() : "";
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];

  if (!name || !phone || !address) {
    return NextResponse.json(
      { success: false, error: "Name, phone and delivery address are required" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(shippingFee) || shippingFee < 0) {
    return NextResponse.json(
      { success: false, error: "Invalid delivery charge" },
      { status: 400 }
    );
  }
  if (rawItems.length === 0) {
    return NextResponse.json<CheckoutResponse>(
      { success: false, order_id: "", error: "Your bag is empty" } as CheckoutResponse,
      { status: 400 }
    );
  }

  const items: CheckoutItemPayload[] = [];
  for (const raw of rawItems) {
    const it = raw as Partial<CheckoutItemPayload>;
    const quantity = Number(it?.quantity);
    if (!it?.product_id || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json(
        { success: false, error: "An item has an invalid quantity" },
        { status: 400 }
      );
    }
    items.push({
      product_id: String(it.product_id),
      // Replaced below by the server-side resolver.
      variant_id: typeof it.variant_id === "string" ? it.variant_id : "",
      title: typeof it.title === "string" ? it.title : "",
      size: typeof it.size === "string" ? it.size : "",
      color: typeof it.color === "string" ? it.color : "",
      quantity,
      image: typeof it.image === "string" ? it.image : undefined,
    });
  }

  try {
    const cookieStore = cookies();
    const supabase = createSupabaseServerClient({
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        // Read-only here; the middleware refreshes the session.
      },
    });

    if (!supabase) {
      return NextResponse.json({ success: false, error: "Service not configured" }, { status: 500 });
    }

    // Resolve variants server-side. The browser-supplied variant_id is
    // ignored entirely: it is untrusted input, and a wrong value would
    // reserve the wrong stock.
    const resolved = await Promise.all(
      items.map(async (it, index) => {
        const { data, error } = await supabase.rpc("resolve_order_variant", {
          p_product_id: it.product_id,
          p_size: it.size,
          p_color: it.color,
        });
        if (error) {
          throw new Error(`variant_lookup_failed:${index}`);
        }
        return typeof data === "string" ? data : null;
      })
    );

    const unresolvable = resolved.findIndex((v) => !v);
    if (unresolvable !== -1) {
      const bad = items[unresolvable];
      return NextResponse.json(
        {
          success: false,
          error: `We could not confirm the option for "${bad.title || bad.product_id}". Please choose a colour and size and try again.`,
        },
        { status: 422 }
      );
    }

    const rpcItems = items.map((it, i) => ({ ...it, variant_id: resolved[i] as string }));

    const { data, error } = await supabase.rpc("create_order_with_reservations", {
      payload: {
        customer_name: name,
        customer_phone: phone,
        customer_email: payload.customer_email?.trim() || null,
        delivery_address: address,
        city: payload.city === "outside" ? "Outside Dhaka" : "Dhaka Metro",
        shipping_fee: shippingFee,
        payment_method: payload.payment_method ?? "cod",
        coupon_code: couponCode || null,
        items: rpcItems,
      },
    });

    if (error) {
      const reason = reasonOf(error.message);
      const mapped = REJECTIONS[reason];
      return NextResponse.json(
        {
          success: false,
          error: mapped?.message ?? "We could not place your order. Please try again.",
          reason,
        },
        { status: mapped?.status ?? 500 }
      );
    }

    const result = data as {
      order_id: string;
      subtotal: number;
      discount_total: number;
      coupon_discount_total: number;
      coupon_code: string | null;
      shipping_fee: number;
      total_amount: number;
    };

    return NextResponse.json<CheckoutResponse>({
      success: true,
      order_id: result.order_id,
      subtotal: Number(result.subtotal),
      discount_total: Number(result.discount_total),
      coupon_discount_total: Number(result.coupon_discount_total ?? 0),
      coupon_code: result.coupon_code ?? null,
      shipping_fee: Number(result.shipping_fee),
      total_amount: Number(result.total_amount),
    });
  } catch (error) {
    console.error("Checkout failed:", error);
    const isLookup =
      error instanceof Error && error.message.startsWith("variant_lookup_failed");
    return NextResponse.json(
      {
        success: false,
        error: isLookup
          ? "We could not confirm the options in your bag. Please try again."
          : "We could not place your order. Please try again.",
      },
      { status: isLookup ? 502 : 500 }
    );
  }
}
