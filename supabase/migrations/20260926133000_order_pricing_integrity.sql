-- ==========================================================
-- create_order_with_reservations(): server-authoritative pricing
--
-- Previously this function inserted order_items.unit_price and
-- orders.subtotal straight from the client payload, and is
-- executable by anyone ("Anyone can create orders" RLS policy).
-- A client could therefore assert any price it liked.
--
-- Now every money figure is derived server-side from
-- get_effective_prices(), and each line snapshots the discount that
-- produced it. Payload unit_price/subtotal are ignored.
--
-- Stock reservation behaviour, showroom selection, order id
-- generation and reservation expiry are all unchanged.
--
-- orders.subtotal keeps its existing meaning (sum of DISCOUNTED
-- line totals) so total_amount = subtotal + shipping_fee still holds
-- and historical orders stay valid. Reconciliation is:
--   SUM(base_price * qty) - discount_total = subtotal
-- ==========================================================

CREATE OR REPLACE FUNCTION public.create_order_with_reservations(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_order_id TEXT := COALESCE(
        NULLIF(payload->>'order_id', ''),
        'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
    );
    v_shipping       NUMERIC := COALESCE(NULLIF(payload->>'shipping_fee', '')::NUMERIC, 0);
    v_subtotal       NUMERIC := 0;
    v_discount_total NUMERIC := 0;
    v_prices         JSONB;
    v_price          JSONB;
    v_item           JSONB;
    v_quantity       INTEGER;
    v_stock          public.product_stock%ROWTYPE;
    v_item_id        TEXT;
    v_reservation_id TEXT;
    v_showroom_id    TEXT;
    v_final_price    NUMERIC;
    v_base_price     NUMERIC;
BEGIN
    IF v_shipping < 0 THEN
        RAISE EXCEPTION 'invalid_shipping_fee' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(COALESCE(payload->'items', '[]'::JSONB)) = 0 THEN
        RAISE EXCEPTION 'empty_order' USING ERRCODE = '22023';
    END IF;

    -- Server-authoritative prices for every product in the cart
    SELECT COALESCE(jsonb_object_agg(e.product_id, to_jsonb(e)), '{}'::JSONB)
    INTO v_prices
    FROM public.get_effective_prices(ARRAY(
        SELECT DISTINCT t.item->>'product_id'
        FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::JSONB)) AS t(item)
        WHERE NULLIF(t.item->>'product_id', '') IS NOT NULL
    )) e;

    -- Pass 1: compute money before the order row exists
    FOR v_item IN
        SELECT t.item
        FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::JSONB)) AS t(item)
    LOOP
        v_quantity := COALESCE((v_item->>'quantity')::INTEGER, 0);
        IF v_quantity <= 0 THEN
            RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
        END IF;

        v_price := v_prices -> (v_item->>'product_id');
        IF v_price IS NULL THEN
            RAISE EXCEPTION 'product_not_found:%', v_item->>'product_id' USING ERRCODE = '22023';
        END IF;

        v_final_price := (v_price->>'final_price')::NUMERIC;
        v_base_price  := (v_price->>'base_price')::NUMERIC;

        v_subtotal       := v_subtotal + (v_final_price * v_quantity);
        v_discount_total := v_discount_total + ((v_base_price - v_final_price) * v_quantity);
    END LOOP;

    v_subtotal       := ROUND(v_subtotal, 2);
    v_discount_total := ROUND(v_discount_total, 2);

    INSERT INTO public.orders (
        id, user_id, customer_name, customer_phone, customer_email,
        delivery_address, city, subtotal, discount_total, shipping_fee, total_amount,
        payment_method, status
    ) VALUES (
        v_order_id,
        auth.uid(),
        payload->>'customer_name',
        payload->>'customer_phone',
        NULLIF(payload->>'customer_email', ''),
        payload->>'delivery_address',
        payload->>'city',
        v_subtotal,
        v_discount_total,
        v_shipping,
        v_subtotal + v_shipping,
        COALESCE(NULLIF(payload->>'payment_method', ''), 'cod'),
        'pending'
    );

    -- Pass 2: reserve stock and write lines with the discount snapshot
    FOR v_item IN
        SELECT t.item
        FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::JSONB)) AS t(item)
    LOOP
        v_quantity := COALESCE((v_item->>'quantity')::INTEGER, 0);

        v_price       := v_prices -> (v_item->>'product_id');
        v_final_price := (v_price->>'final_price')::NUMERIC;
        v_base_price  := (v_price->>'base_price')::NUMERIC;

        v_showroom_id := NULL;
        SELECT st.* INTO v_stock
        FROM public.product_stock st
        JOIN public.showrooms s ON s.id = st.showroom_id
        WHERE st.variant_id = v_item->>'variant_id'
          AND s.is_active
          AND st.quantity - st.reserved_quantity >= v_quantity
        ORDER BY s.fulfillment_priority ASC, st.showroom_id
        LIMIT 1
        FOR UPDATE OF st;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'insufficient_stock:%', v_item->>'variant_id' USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.product_stock
        SET reserved_quantity = reserved_quantity + v_quantity, updated_at = now()
        WHERE variant_id = v_stock.variant_id AND showroom_id = v_stock.showroom_id;

        INSERT INTO public.order_items (
            order_id, product_id, title, size, color, quantity,
            unit_price, base_price, image, variant_id, showroom_id,
            applied_discount_type, applied_discount_value,
            promotion_id, promotion_name
        ) VALUES (
            v_order_id,
            v_item->>'product_id',
            v_item->>'title',
            COALESCE(v_item->>'size', ''),
            COALESCE(v_item->>'color', ''),
            v_quantity,
            v_final_price,
            v_base_price,
            NULLIF(v_item->>'image', ''),
            v_item->>'variant_id',
            v_stock.showroom_id,
            (v_price->>'discount_type')::TEXT,
            (v_price->>'discount_value')::NUMERIC,
            NULLIF(v_price->>'promotion_id', ''),
            v_price->>'promotion_name'
        ) RETURNING id INTO v_item_id;

        INSERT INTO public.stock_reservations (variant_id, showroom_id, order_item_id, quantity, status, expires_at)
        VALUES (v_stock.variant_id, v_stock.showroom_id, v_item_id, v_quantity, 'reserved', now() + interval '30 minutes')
        RETURNING id INTO v_reservation_id;

        INSERT INTO public.inventory_movements (variant_id, showroom_id, delta, reason, reference_id)
        VALUES (v_stock.variant_id, v_stock.showroom_id, 0, 'reservation', v_reservation_id);
    END LOOP;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'status', 'reserved',
        'subtotal', v_subtotal,
        'discount_total', v_discount_total,
        'shipping_fee', v_shipping,
        'total_amount', v_subtotal + v_shipping
    );
END;
$$;
