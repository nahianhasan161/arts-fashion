-- ==========================================================
-- admin_save_promotion(): SECURITY DEFINER write path
--
-- Mirrors admin_save_product(): re-checks is_admin() server-side,
-- raises ERRCODE 22023 with a snake_case message on bad input.
--
-- Why an RPC and not just RLS: the flat-discount ceiling depends on
-- the MINIMUM regular_price across the attached products, which a
-- CHECK constraint cannot express (no cross-row visibility).
-- calculate_sale_price() would silently clamp an over-large flat
-- discount to 0, i.e. a 100%-off giveaway, so it must be rejected.
-- ==========================================================

CREATE OR REPLACE FUNCTION public.admin_save_promotion(payload jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id        TEXT := NULLIF(payload->>'id', '');
    v_name      TEXT := NULLIF(btrim(payload->>'name'), '');
    v_dtype     TEXT := COALESCE(NULLIF(payload->>'discount_type', ''), 'percentage');
    v_value     NUMERIC := COALESCE(NULLIF(payload->>'discount_value', '')::NUMERIC, 0);
    v_starts_at TIMESTAMPTZ := NULLIF(payload->>'starts_at', '')::TIMESTAMPTZ;
    v_ends_at   TIMESTAMPTZ := NULLIF(payload->>'ends_at', '')::TIMESTAMPTZ;
    v_status    TEXT := COALESCE(NULLIF(payload->>'status', ''), 'draft');
    v_min_price NUMERIC;
    v_dup       TEXT;
    v_count     INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
    END IF;
    IF v_starts_at IS NULL OR v_ends_at IS NULL THEN
        RAISE EXCEPTION 'timeframe_required' USING ERRCODE = '22023';
    END IF;
    IF v_ends_at <= v_starts_at THEN
        RAISE EXCEPTION 'invalid_timeframe' USING ERRCODE = '22023';
    END IF;
    IF v_dtype NOT IN ('flat', 'percentage') THEN
        RAISE EXCEPTION 'invalid_discount_type' USING ERRCODE = '22023';
    END IF;
    IF v_value < 0 THEN
        RAISE EXCEPTION 'invalid_discount_value' USING ERRCODE = '22023';
    END IF;
    IF v_dtype = 'percentage' AND v_value > 100 THEN
        RAISE EXCEPTION 'invalid_percentage_discount' USING ERRCODE = '22023';
    END IF;
    IF v_status NOT IN ('draft', 'active', 'cancelled') THEN
        RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;

    -- Unique name, excluding self on update
    SELECT id INTO v_dup
    FROM public.promotions
    WHERE lower(name) = lower(v_name) AND (v_id IS NULL OR id <> v_id)
    LIMIT 1;
    IF v_dup IS NOT NULL THEN
        RAISE EXCEPTION 'duplicate_promotion_name' USING ERRCODE = '23505';
    END IF;

    -- Reject unknown product ids before writing anything
    SELECT count(*) INTO v_count
    FROM jsonb_array_elements_text(COALESCE(payload->'product_ids', '[]'::JSONB)) AS t(pid)
    WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = t.pid);
    IF v_count > 0 THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
    END IF;

    -- Flat discount may not exceed the cheapest attached product
    IF v_dtype = 'flat' AND v_value > 0 THEN
        SELECT MIN(COALESCE(p.regular_price, p.original_price, 0)) INTO v_min_price
        FROM jsonb_array_elements_text(COALESCE(payload->'product_ids', '[]'::JSONB)) AS t(pid)
        JOIN public.products p ON p.id = t.pid;

        IF v_min_price IS NULL THEN
            RAISE EXCEPTION 'product_not_found' USING ERRCODE = '22023';
        END IF;
        IF v_value > v_min_price THEN
            RAISE EXCEPTION 'invalid_flat_discount' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO public.promotions (
            name, description, discount_type, discount_value,
            starts_at, ends_at, status, badge_label
        ) VALUES (
            v_name,
            NULLIF(btrim(payload->>'description'), ''),
            v_dtype, v_value,
            v_starts_at, v_ends_at, v_status,
            NULLIF(btrim(payload->>'badge_label'), '')
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.promotions SET
            name          = v_name,
            description   = NULLIF(btrim(payload->>'description'), ''),
            discount_type = v_dtype,
            discount_value= v_value,
            starts_at     = v_starts_at,
            ends_at       = v_ends_at,
            status        = v_status,
            badge_label   = NULLIF(btrim(payload->>'badge_label'), ''),
            updated_at    = now()
        WHERE id = v_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'promotion_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    -- Only touch links when product_ids is supplied, so a partial
    -- update cannot silently detach every product.
    IF payload ? 'product_ids' THEN
        DELETE FROM public.promotion_products WHERE promotion_id = v_id;
        INSERT INTO public.promotion_products (promotion_id, product_id)
        SELECT v_id, t.pid
        FROM jsonb_array_elements_text(COALESCE(payload->'product_ids', '[]'::JSONB)) AS t(pid)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_promotion(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_promotion(jsonb) TO authenticated;
