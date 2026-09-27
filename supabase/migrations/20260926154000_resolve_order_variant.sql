-- ==========================================================
-- resolve_order_variant(): map a cart line to a stock variant
--
-- The order RPC reserves stock per VARIANT, so a checkout line must
-- name a variant. The storefront, however, carries size and colour as
-- display strings: products.sizes / products.colors are denormalised
-- jsonb on the product row, while the canonical rows live in sizes and
-- colors. Matching those in the browser would be guesswork.
--
-- So the checkout API resolves the variant here, against the canonical
-- tables, and this function FAILS SAFE: it returns a variant only when
-- exactly one candidate survives. An ambiguous match returns NULL and
-- the order is refused, because reserving the wrong stock is far worse
-- than asking the customer to choose a colour.
--
-- Preference order when several variants remain: a variant that carries
-- no colour and no size is the product's generic fallback and wins
-- outright, which is the common shape for products that are not
-- configured with a full colour x size matrix.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.resolve_order_variant(
    p_product_id TEXT,
    p_size       TEXT DEFAULT '',
    p_color      TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_size   TEXT := NULLIF(btrim(COALESCE(p_size, '')), '');
    v_color  TEXT := NULLIF(btrim(COALESCE(p_color, '')), '');
    v_cand   TEXT[];
    v_single TEXT;
BEGIN
    IF NULLIF(btrim(COALESCE(p_product_id, '')), '') IS NULL THEN
        RETURN NULL;
    END IF;

    -- Active variants for the product.
    SELECT COALESCE(array_agg(v.id), ARRAY[]::TEXT[])
    INTO v_cand
    FROM public.product_variants v
    WHERE v.product_id = p_product_id
      AND v.is_active;

    IF COALESCE(array_length(v_cand, 1), 0) = 0 THEN
        RETURN NULL;
    END IF;

    -- Narrow by size label against the canonical sizes table. A variant
    -- with no size_id is treated as size-agnostic and never eliminated.
    IF v_size IS NOT NULL THEN
        SELECT COALESCE(array_agg(x.id), ARRAY[]::TEXT[])
        INTO v_cand
        FROM unnest(v_cand) AS x(id)
        JOIN public.product_variants v ON v.id = x.id
        WHERE v.size_id IS NULL
           OR EXISTS (
               SELECT 1 FROM public.sizes s
               WHERE s.id = v.size_id
                 AND (lower(s.name) = lower(v_size)
                      OR lower(s.display_name) = lower(v_size)
                      OR lower(s.name) || ' ' || COALESCE(s.display_name, '') = lower(v_size))
           );

        IF COALESCE(array_length(v_cand, 1), 0) = 0 THEN
            RETURN NULL;
        END IF;
    END IF;

    -- Narrow by colour name, same rule.
    IF v_color IS NOT NULL THEN
        SELECT COALESCE(array_agg(x.id), ARRAY[]::TEXT[])
        INTO v_cand
        FROM unnest(v_cand) AS x(id)
        JOIN public.product_variants v ON v.id = x.id
        WHERE v.color_id IS NULL
           OR EXISTS (
               SELECT 1 FROM public.colors c
               WHERE c.id = v.color_id
                 AND lower(c.name) = lower(v_color)
           );

        IF COALESCE(array_length(v_cand, 1), 0) = 0 THEN
            RETURN NULL;
        END IF;
    END IF;

    IF array_length(v_cand, 1) = 1 THEN
        RETURN v_cand[1];
    END IF;

    -- Still ambiguous: a fully generic variant is unambiguous in
    -- practice, so prefer it if there is exactly one.
    SELECT count(*) INTO v_single
    FROM unnest(v_cand) AS x(id)
    JOIN public.product_variants v ON v.id = x.id
    WHERE v.color_id IS NULL AND v.size_id IS NULL;

    IF v_single = 1 THEN
        SELECT x.id INTO v_single
        FROM unnest(v_cand) AS x(id)
        JOIN public.product_variants v ON v.id = x.id
        WHERE v.color_id IS NULL AND v.size_id IS NULL;
        RETURN v_single::TEXT;
    END IF;

    -- Genuinely ambiguous: refuse rather than guess.
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_order_variant(TEXT, TEXT, TEXT) TO anon, authenticated;
