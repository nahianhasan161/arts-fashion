-- ==========================================================
-- Coupon logic: eligibility, quoting, allocation, checkout
--
-- The three-layer discount stack (markdown -> promotion -> coupon)
-- is resolved in exactly one place per concern:
--
--   coupon_ineligibility_reason()  who may use this coupon
--   coupon_quote()                 what it is worth on THIS cart
--   coupon_allocations()           how to spread it over the lines
--
-- validate_coupon() is the storefront entry point over all three.
-- create_order_with_reservations() re-runs the first two under a row
-- lock instead of trusting the client, so a customer cannot replay a
-- quote they were never entitled to, and two concurrent checkouts
-- cannot both consume the last use.
-- ==========================================================

-- ------------------------------------------------------------
-- 1. Eligibility: returns NULL when usable, else a reason code.
--
-- STABLE and SECURITY DEFINER so it can read profiles/membership and
-- the redemption ledger on behalf of an anonymous caller while still
-- judging that caller by THEIR auth.uid(). SECURITY DEFINER does not
-- change auth.uid(); it only changes the table privileges.
--
-- Reason codes (mapped to human text in the client):
--   coupon_not_found, coupon_inactive, coupon_not_started,
--   coupon_expired, coupon_login_required, coupon_wrong_group,
--   coupon_used_up, coupon_user_limit_reached
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_ineligibility_reason(p_coupon_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_c    public.coupons%ROWTYPE;
    v_uid  UUID := auth.uid();
    v_used INTEGER;
    v_now  TIMESTAMPTZ := now();
BEGIN
    SELECT * INTO v_c FROM public.coupons WHERE id = p_coupon_id;
    IF NOT FOUND THEN
        RETURN 'coupon_not_found';
    END IF;

    IF v_c.status <> 'active' THEN
        RETURN 'coupon_inactive';
    END IF;
    IF v_now < v_c.starts_at THEN
        RETURN 'coupon_not_started';
    END IF;
    IF v_now >= v_c.ends_at THEN
        RETURN 'coupon_expired';
    END IF;

    -- Group gate. A member-only code requires a session; a guest
    -- cannot prove membership, so it is rejected rather than
    -- silently downgraded to a smaller discount.
    IF v_c.group_id IS NOT NULL THEN
        IF v_uid IS NULL THEN
            RETURN 'coupon_login_required';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.user_group_members m
            WHERE m.group_id = v_c.group_id AND m.user_id = v_uid
        ) THEN
            RETURN 'coupon_wrong_group';
        END IF;
    END IF;

    -- Redemptions on cancelled orders do not count against the
    -- budget: a cancelled order consumed nothing.
    IF v_c.max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_used
        FROM public.coupon_redemptions r
        JOIN public.orders o ON o.id = r.order_id
        WHERE r.coupon_id = v_c.id
          AND o.status <> 'cancelled';
        IF v_used >= v_c.max_uses THEN
            RETURN 'coupon_used_up';
        END IF;
    END IF;

    -- Per-user cap applies to signed-in redeemers only.
    IF v_uid IS NOT NULL AND v_c.max_uses_per_user IS NOT NULL THEN
        SELECT count(*) INTO v_used
        FROM public.coupon_redemptions r
        JOIN public.orders o ON o.id = r.order_id
        WHERE r.coupon_id = v_c.id
          AND r.user_id = v_uid
          AND o.status <> 'cancelled';
        IF v_used >= v_c.max_uses_per_user THEN
            RETURN 'coupon_user_limit_reached';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.coupon_ineligibility_reason(TEXT) FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. Quote: what the coupon is worth on a specific cart.
--
-- p_items is the same jsonb array the order function receives:
--   [{"product_id": "...", "quantity": 2}, ...]
--
-- Prices come from get_effective_prices(), i.e. already reduced by
-- any running promotion, so the quote is exactly what the customer
-- will be charged. minimum_order_value is therefore tested against
-- the post-promotion subtotal, not the list price.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_quote(p_coupon_id TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_c         public.coupons%ROWTYPE;
    v_prices    JSONB;
    v_base      NUMERIC := 0;
    v_eligible  INTEGER := 0;
    v_amount    NUMERIC;
BEGIN
    SELECT * INTO v_c FROM public.coupons WHERE id = p_coupon_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', FALSE, 'reason', 'coupon_not_found');
    END IF;

    SELECT COALESCE(jsonb_object_agg(e.product_id, to_jsonb(e)), '{}'::JSONB)
    INTO v_prices
    FROM public.get_effective_prices(ARRAY(
        SELECT DISTINCT t.item->>'product_id'
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) AS t(item)
        WHERE NULLIF(t.item->>'product_id', '') IS NOT NULL
    )) e;

    SELECT COALESCE(SUM(elig.base), 0), count(*)
    INTO v_base, v_eligible
    FROM (
        SELECT (x.pr->>'final_price')::NUMERIC * e.qty AS base
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) AS t(item)
        CROSS JOIN LATERAL (
            SELECT GREATEST(COALESCE((t.item->>'quantity')::INTEGER, 0), 0) AS qty
        ) e
        LEFT JOIN LATERAL (SELECT v_prices -> (t.item->>'product_id') AS pr) x ON TRUE
        WHERE x.pr IS NOT NULL
          AND e.qty > 0
          AND (
              v_c.applies_to = 'order'
              OR EXISTS (
                  SELECT 1 FROM public.coupon_products cp
                  WHERE cp.coupon_id = v_c.id
                    AND cp.product_id = t.item->>'product_id'
              )
          )
    ) elig;

    IF v_eligible = 0 OR v_base <= 0 THEN
        RETURN jsonb_build_object('valid', FALSE, 'reason', 'coupon_no_eligible_products');
    END IF;

    IF v_base < v_c.minimum_order_value THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'reason', 'coupon_min_order',
            'minimum_order_value', v_c.minimum_order_value,
            'discount_base', ROUND(v_base, 2)
        );
    END IF;

    -- A flat coupon can never exceed the eligible base, so the stack
    -- cannot drive a line negative. LEAST() here is the equivalent of
    -- the ceiling admin_save_promotion() enforces, applied at read
    -- time because the cart size is only known now.
    v_amount := CASE
        WHEN v_c.discount_type = 'percentage'
            THEN ROUND(v_base * v_c.discount_value / 100.0, 2)
        ELSE LEAST(ROUND(v_c.discount_value, 2), v_base)
    END;
    v_amount := LEAST(GREATEST(COALESCE(v_amount, 0), 0), v_base);

    RETURN jsonb_build_object(
        'valid', TRUE,
        'coupon_id', v_c.id,
        'code', v_c.code,
        'description', v_c.description,
        'discount_type', v_c.discount_type,
        'discount_value', v_c.discount_value,
        'discount_base', ROUND(v_base, 2),
        'discount_amount', v_amount,
        'applies_to', v_c.applies_to
    );
END;
$$;

REVOKE ALL ON FUNCTION public.coupon_quote(TEXT, JSONB) FROM PUBLIC;

-- ------------------------------------------------------------
-- 3. Allocation: spread the coupon across lines.
--
-- Returns {"discount_amount": N, "allocations": [a0, a1, ...]} where
-- the array is positionally aligned with p_items by position, so the
-- order function reads allocations[i] for items[i] directly.
--
-- Proportional to line value. Each allocation is clamped to its own
-- line total, so the stack can never drive a line negative. The
-- rounding residue is then pushed onto the largest line, which is
-- clamped again; a clamp that binds leaves at most a sub-unit drift
-- in the SAFE direction (the customer is charged slightly more than
-- quoted, never less). Any residual is immaterial because the order
-- function derives discount_total from the stored unit_price rather
-- than from this array.
--
-- Ineligible lines (applies_to='products' and the product is not
-- attached) get 0 and keep their post-promotion price untouched.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coupon_allocations(p_coupon_id TEXT, p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_c      public.coupons%ROWTYPE;
    v_prices JSONB;
    v_quote  JSONB;
    v_amount NUMERIC;
    v_base   NUMERIC;
    v_alloc  JSONB;
    v_total  NUMERIC;
    v_resid  NUMERIC;
    v_anchor INTEGER;
    v_anchor_base NUMERIC;
BEGIN
    SELECT * INTO v_c FROM public.coupons WHERE id = p_coupon_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('discount_amount', 0, 'allocations',
            COALESCE((SELECT jsonb_agg(0::NUMERIC ORDER BY t.ord)
                      FROM jsonb_array_elements(COALESCE(p_items,'[]'::JSONB))
                           WITH ORDINALITY AS t(item, ord)), '[]'::JSONB));
    END IF;

    SELECT COALESCE(jsonb_object_agg(e.product_id, to_jsonb(e)), '{}'::JSONB)
    INTO v_prices
    FROM public.get_effective_prices(ARRAY(
        SELECT DISTINCT t.item->>'product_id'
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) AS t(item)
        WHERE NULLIF(t.item->>'product_id', '') IS NOT NULL
    )) e;

    v_quote := public.coupon_quote(p_coupon_id, p_items);
    IF NOT COALESCE((v_quote->>'valid')::BOOLEAN, FALSE) THEN
        RETURN jsonb_build_object('discount_amount', 0, 'allocations',
            COALESCE((SELECT jsonb_agg(0::NUMERIC ORDER BY t.ord)
                      FROM jsonb_array_elements(COALESCE(p_items,'[]'::JSONB))
                           WITH ORDINALITY AS t(item, ord)), '[]'::JSONB));
    END IF;

    v_amount := (v_quote->>'discount_amount')::NUMERIC;
    v_base   := (v_quote->>'discount_base')::NUMERIC;

    IF v_amount <= 0 OR v_base <= 0 THEN
        RETURN jsonb_build_object('discount_amount', 0, 'allocations',
            COALESCE((SELECT jsonb_agg(0::NUMERIC ORDER BY t.ord)
                      FROM jsonb_array_elements(COALESCE(p_items,'[]'::JSONB))
                           WITH ORDINALITY AS t(item, ord)), '[]'::JSONB));
    END IF;

    -- Positional array. Every item produces one element, so indexes
    -- always line up with p_items even when a line is ineligible.
    SELECT COALESCE(jsonb_agg(
               ROUND(
                   CASE WHEN ln.eligible AND ln.base > 0
                        THEN LEAST(v_amount * ln.base / v_base, ln.base)
                        ELSE 0
                   END, 2
               ) ORDER BY ln.idx), '[]'::JSONB)
    INTO v_alloc
    FROM (
        SELECT (t.ord - 1)                                        AS idx,
               (x.pr->>'final_price')::NUMERIC
                   * GREATEST(COALESCE((t.item->>'quantity')::INTEGER, 0), 0) AS base,
               (v_c.applies_to = 'order' OR EXISTS (
                    SELECT 1 FROM public.coupon_products cp
                    WHERE cp.coupon_id = v_c.id
                      AND cp.product_id = t.item->>'product_id'
               ))                                                AS eligible
        FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
             WITH ORDINALITY AS t(item, ord)
        LEFT JOIN LATERAL (SELECT v_prices -> (t.item->>'product_id') AS pr) x ON TRUE
        WHERE x.pr IS NOT NULL
          AND GREATEST(COALESCE((t.item->>'quantity')::INTEGER, 0), 0) > 0
    ) ln;

    -- Anchor = the eligible line with the most value, so the residue
    -- lands where it is least visible and least likely to clamp.
    SELECT ln.idx, ln.base INTO v_anchor, v_anchor_base
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB))
         WITH ORDINALITY AS t(item, ord)
    LEFT JOIN LATERAL (SELECT v_prices -> (t.item->>'product_id') AS pr) x ON TRUE
    CROSS JOIN LATERAL (
        SELECT (t.ord - 1) AS idx,
               (x.pr->>'final_price')::NUMERIC
                   * GREATEST(COALESCE((t.item->>'quantity')::INTEGER, 0), 0) AS base
    ) ln
    WHERE x.pr IS NOT NULL
      AND ln.base > 0
      AND (v_c.applies_to = 'order' OR EXISTS (
            SELECT 1 FROM public.coupon_products cp
            WHERE cp.coupon_id = v_c.id AND cp.product_id = t.item->>'product_id'))
    ORDER BY ln.base DESC, ln.idx ASC
    LIMIT 1;

    IF v_anchor IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE((e.val)::NUMERIC, 0)), 0) INTO v_total
        FROM jsonb_array_elements(v_alloc) AS e(val);

        v_resid := ROUND(v_amount - v_total, 2);
        IF v_resid <> 0 THEN
            v_alloc := jsonb_set(
                v_alloc,
                ARRAY[v_anchor::TEXT],
                to_jsonb(LEAST(GREATEST(
                    COALESCE((v_alloc -> v_anchor)::NUMERIC, 0) + v_resid, 0),
                    v_anchor_base)),
                FALSE
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('discount_amount', v_amount, 'allocations', v_alloc);
END;
$$;

REVOKE ALL ON FUNCTION public.coupon_allocations(TEXT, JSONB) FROM PUBLIC;

-- ------------------------------------------------------------
-- 4. validate_coupon(): the storefront entry point.
--
-- Runs the three steps above in order, so a caller only ever learns
-- what they are entitled to. A non-member probing member-only codes
-- learns only 'coupon_wrong_group', never the segment name, the
-- discount, or whether the code exists for other users.
--
-- Safe to call anonymously: it is read-only and reveals nothing but
-- the caller's own entitlement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT, p_items JSONB DEFAULT '[]'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_code   TEXT := upper(btrim(COALESCE(p_code, '')));
    v_id     TEXT;
    v_reason TEXT;
BEGIN
    IF v_code = '' THEN
        RETURN jsonb_build_object('valid', FALSE, 'reason', 'coupon_empty');
    END IF;

    SELECT c.id INTO v_id
    FROM public.coupons c
    WHERE upper(c.code) = v_code;

    IF v_id IS NULL THEN
        RETURN jsonb_build_object('valid', FALSE, 'reason', 'coupon_not_found');
    END IF;

    v_reason := public.coupon_ineligibility_reason(v_id);
    IF v_reason IS NOT NULL THEN
        RETURN jsonb_build_object('valid', FALSE, 'reason', v_reason);
    END IF;

    RETURN public.coupon_quote(v_id, p_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, JSONB) TO anon, authenticated;
