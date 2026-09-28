-- ==========================================================
-- SINGLE-AXIS VARIANTS HONOUR STOCK, SKU AND PRICE OVERRIDE
--
-- A product may be sold in colours and no sizes, or in sizes and no colours.
-- VariantMatrix already builds the same one-column table for that case, so the
-- admin can fill in a stock figure, a SKU and a price override per row, and
-- buildPayload sends all of them.
--
-- admin_save_product ignored them. The _wanted query that feeds the upsert had
-- three branches, and only the cross-product branch carried the correlated
-- subqueries that read those fields off the payload. The two single-axis
-- branches were written as literal rows:
--
--     SELECT c.color_id, NULL, 0, NULL, NULL, true
--
-- which reads like a default but is a hardcoded value. Every save of a
-- colour-only or size-only product wrote stock 0 and a null SKU, and because
-- products.stock is a trigger-maintained sum of the active variants, the
-- product total came out as 0 as well. A product in three colours could not
-- be given stock at all.
--
-- Verified against the live database before this change: saving one colour at
-- stock 12 with SKU "SKU-REAL-1" and a 450 price override stored stock 0,
-- sku null and override null.
--
-- The fix gives both branches the same lookups as the cross-product, matching
-- the absent axis with NULL via IS NOT DISTINCT FROM. The function body is
-- reproduced because CREATE OR REPLACE needs all of it.
-- ==========================================================


CREATE OR REPLACE FUNCTION public.admin_save_product(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_payload    JSONB := COALESCE(p_payload, '{}'::JSONB);
    v_id         TEXT;
    v_title      TEXT;
    v_slug       TEXT;
    v_base       TEXT;
    v_try        INTEGER := 1;
    v_cat_id     TEXT;
    v_sub_id     TEXT;
    v_cat_name   TEXT;
    v_sub_name   TEXT;
    v_regular    NUMERIC;
    v_sale       NUMERIC;
    v_dtype      TEXT;
    v_dvalue     NUMERIC;
    v_status     TEXT;
    v_discount_pct INTEGER;
    v_short_desc TEXT;
    v_tags       TEXT[];
    v_cost       NUMERIC;
    v_color_ids  TEXT[] := ARRAY[]::TEXT[];
    v_size_ids   TEXT[] := ARRAY[]::TEXT[];
    v_promo_ids  TEXT[] := ARRAY[]::TEXT[];
    v_variants   JSONB  := COALESCE(p_payload->'variants', '[]'::JSONB);
    v_color_rows JSONB;
    v_size_rows  JSONB;
    v_cells      INTEGER;
    v_result     JSONB;
    v_wanted     RECORD;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    -- ---------- identity
    v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
    IF v_title IS NULL THEN
        RAISE EXCEPTION 'title_required' USING ERRCODE = '22023';
    END IF;

    v_id := NULLIF(btrim(COALESCE(p_payload->>'id', '')), '');

    -- The product is looked up BEFORE the slug is settled. A form left open
    -- while the product is deleted elsewhere sends an id that no longer
    -- exists together with the slug that product used to have, and the
    -- useful answer is "that product is gone", not "that slug is taken".
    IF v_id IS NOT NULL THEN
        PERFORM 1 FROM public.products WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    -- The slug is derived when omitted. It is generated data, and a blank
    -- slug was the most common reason a product could not be saved.
    --
    -- A DERIVED slug is made unique rather than refused, because two
    -- products may legitimately share a title and the admin never asked for
    -- either slug. An EXPLICIT slug is refused when taken, because there the
    -- admin did choose it and silently rewriting it would hand back a URL
    -- they did not ask for.
    IF btrim(COALESCE(p_payload->>'slug', '')) = '' THEN
        v_slug := trim(both '-' FROM lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g')));
        IF v_slug = '' THEN
            RAISE EXCEPTION 'slug_required' USING ERRCODE = '22023';
        END IF;
        v_base := v_slug;
        v_try := 1;
        LOOP
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.products
                WHERE slug = v_slug AND (v_id IS NULL OR id <> v_id)
            );
            v_try := v_try + 1;
            v_slug := v_base || '-' || v_try;
            -- Bounded so a pathological title cannot spin here forever.
            EXIT WHEN v_try > 1000;
        END LOOP;
    ELSE
        v_slug := lower(btrim(p_payload->>'slug'));
        IF EXISTS (
            SELECT 1 FROM public.products
            WHERE slug = v_slug AND (v_id IS NULL OR id <> v_id)
        ) THEN
            RAISE EXCEPTION 'slug_taken' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- ---------- categorisation
    v_cat_id := NULLIF(btrim(COALESCE(p_payload->>'category_id', '')), '');
    v_sub_id := NULLIF(btrim(COALESCE(p_payload->>'sub_category_id', '')), '');

    IF v_cat_id IS NULL THEN
        RAISE EXCEPTION 'category_required' USING ERRCODE = '22023';
    END IF;
    PERFORM 1 FROM public.categories WHERE id = v_cat_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'category_not_found' USING ERRCODE = '22023';
    END IF;

    IF v_sub_id IS NOT NULL THEN
        PERFORM 1 FROM public.categories WHERE id = v_sub_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'subcategory_not_found' USING ERRCODE = '22023';
        END IF;
        -- The catalogue is two levels deep and the size guide looks up
        -- exactly that shape, so a sub-category of a sub-category would
        -- match nothing.
        IF NOT EXISTS (
            SELECT 1 FROM public.categories WHERE id = v_sub_id AND parent_id = v_cat_id
        ) THEN
            RAISE EXCEPTION 'subcategory_not_found' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- ---------- money
    -- The sale price is DERIVED from the regular price and the discount,
    -- never accepted from the client. Two separately entered prices can
    -- disagree, and when they do the storefront quietly shows a negative
    -- discount on every badge and a crossed-out price below the price.
    v_regular := COALESCE(NULLIF(p_payload->>'regular_price', '')::NUMERIC, 0);
    IF v_regular < 0 THEN
        RAISE EXCEPTION 'invalid_regular_price' USING ERRCODE = '22023';
    END IF;

    v_dtype := COALESCE(NULLIF(p_payload->>'discount_type', ''), 'percentage');
    IF v_dtype NOT IN ('flat', 'percentage') THEN
        RAISE EXCEPTION 'invalid_discount_type' USING ERRCODE = '22023';
    END IF;

    v_dvalue := COALESCE(NULLIF(p_payload->>'discount_value', '')::NUMERIC, 0);
    IF v_dvalue < 0 THEN
        RAISE EXCEPTION 'invalid_discount' USING ERRCODE = '22023';
    END IF;
    IF v_dtype = 'percentage' AND v_dvalue > 100 THEN
        RAISE EXCEPTION 'invalid_percentage_discount' USING ERRCODE = '22023';
    END IF;
    IF v_dtype = 'flat' AND v_dvalue > v_regular THEN
        RAISE EXCEPTION 'invalid_flat_discount' USING ERRCODE = '22023';
    END IF;

    v_sale := public.calculate_sale_price(v_regular, v_dtype, v_dvalue);
    v_discount_pct := CASE WHEN v_dtype = 'percentage' THEN v_dvalue::INTEGER ELSE 0 END;

    v_status := COALESCE(NULLIF(p_payload->>'status', ''), 'draft');
    IF v_status NOT IN ('draft', 'published', 'archived') THEN
        RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;

    -- ---------- catalogue fields
    -- short_description, tags and cost_price are authored, unlike price and
    -- discount_percent, which are derived above. They are validated here for
    -- the same reason everything else is: a value the admin did not mean to
    -- save must not be coerced into one they did.
    --
    -- A BLANK string clears the field rather than failing the save. That is
    -- the difference between an empty text box in a form and a form that
    -- cannot be submitted until someone types something into it.
    v_short_desc := NULLIF(btrim(COALESCE(p_payload->>'short_description', '')), '');

    -- Tags are trimmed and de-duplicated case-insensitively while the FIRST
    -- spelling seen is kept, so "Summer" and "summer" cannot both end up in
    -- the array and make an AND-filter miss a product a shopper expected to
    -- see. Case is otherwise preserved: the column stores what was written
    -- and the display layer decides how to render it.
    --
    -- The ORDER this produced turned out to be wrong and is corrected in
    -- 20260927134000: array_agg(DISTINCT ...) guarantees uniqueness and
    -- guarantees nothing about order.
    SELECT COALESCE(array_agg(t.tag ORDER BY t.first_seen), ARRAY[]::TEXT[])
      INTO v_tags
      FROM (
          SELECT btrim(u.tag) AS tag,
                 MIN(u.ord)    AS first_seen
            FROM jsonb_array_elements_text(
                     CASE
                         WHEN jsonb_typeof(p_payload->'tags') = 'array'
                             THEN p_payload->'tags'
                         ELSE '[]'::JSONB
                     END
                 ) WITH ORDINALITY AS u(tag, ord)
           WHERE btrim(u.tag) <> ''
           GROUP BY lower(btrim(u.tag)), btrim(u.tag)
      ) t;

    -- cost_price may legitimately exceed regular_price: a clearance line is
    -- sold below cost on purpose. It is only refused when negative, and a
    -- blank field means "not recorded" rather than zero, because a zero here
    -- would read as free goods to every margin report downstream.
    IF btrim(COALESCE(p_payload->>'cost_price', '')) <> '' THEN
        v_cost := NULLIF(btrim(p_payload->>'cost_price'), '')::NUMERIC;
        IF v_cost < 0 THEN
            RAISE EXCEPTION 'invalid_cost_price' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- ---------- canonical options
    -- Unknown or deactivated ids are an error rather than a silent drop.
    -- The admin selected them, so quietly ignoring one would save a product
    -- that is missing an option they believed they had chosen.
    SELECT COALESCE(array_agg(t.id), ARRAY[]::TEXT[])
    INTO v_color_ids
    FROM jsonb_array_elements_text(COALESCE(p_payload->'color_ids', '[]'::JSONB)) AS t(id)
    JOIN public.colors c ON c.id = t.id AND c.is_active;
    -- COALESCE is load-bearing. array_length of an EMPTY array is NULL,
    -- not 0, so a payload of nothing but unknown ids would compare
    -- "1 <> NULL", which is NULL, and an IF on NULL does not fire. The
    -- guard would pass and the unknown options would be dropped silently.
    IF jsonb_array_length(COALESCE(p_payload->'color_ids', '[]'::JSONB))
       <> COALESCE(array_length(v_color_ids, 1), 0) THEN
        RAISE EXCEPTION 'unknown_color' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(t.id), ARRAY[]::TEXT[])
    INTO v_size_ids
    FROM jsonb_array_elements_text(COALESCE(p_payload->'size_ids', '[]'::JSONB)) AS t(id)
    JOIN public.sizes s ON s.id = t.id AND s.is_active;
    IF jsonb_array_length(COALESCE(p_payload->'size_ids', '[]'::JSONB))
       <> COALESCE(array_length(v_size_ids, 1), 0) THEN
        RAISE EXCEPTION 'unknown_size' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_variants) <> 'array' THEN
        RAISE EXCEPTION 'invalid_variants' USING ERRCODE = '22023';
    END IF;

    -- Stock is validated here rather than clamped at the insert. A number
    -- input in the browser can produce a negative value, and silently
    -- coercing it to zero would save a number the admin never chose while
    -- showing them "0" as though they had entered it. Refusing the save is
    -- the only outcome that surfaces the mistake.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_variants) AS v(item)
        WHERE COALESCE(NULLIF(v.item->>'stock', '')::NUMERIC, 0) < 0
    ) THEN
        RAISE EXCEPTION 'negative_stock' USING ERRCODE = '22023';
    END IF;

    v_cells := GREATEST(COALESCE(array_length(v_color_ids, 1), 0), 1)
             * GREATEST(COALESCE(array_length(v_size_ids, 1), 0), 1);
    IF v_cells > public.product_variant_limit() THEN
        RAISE EXCEPTION 'too_many_variants' USING ERRCODE = '22023';
    END IF;

    -- ---------- the product row
    IF v_id IS NULL THEN
        INSERT INTO public.products (
            id, slug, title, description, short_description, category, sub_category,
            category_id, sub_category_id, regular_price, price, original_price,
            cost_price, tags, discount_type, discount_value, discount_percent, status,
            badge, badge_type, is_featured, specs, rating, reviews_count,
            created_at, updated_at
        )
        SELECT gen_random_uuid()::TEXT, v_slug, v_title,
               NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
               v_short_desc,
               c.name, s.name, v_cat_id, v_sub_id,
               v_regular, v_sale, v_regular,
               v_cost, v_tags,
               v_dtype, v_dvalue, v_discount_pct, v_status,
               NULLIF(btrim(COALESCE(p_payload->>'badge', '')), ''),
               NULLIF(btrim(COALESCE(p_payload->>'badge_type', '')), ''),
               COALESCE((p_payload->>'is_featured')::BOOLEAN, false),
               COALESCE(p_payload->'specs', '{}'::JSONB), 5.0, 0, now(), now()
        FROM public.categories c
        LEFT JOIN public.categories s ON s.id = v_sub_id
        WHERE c.id = v_cat_id
        RETURNING id INTO v_id;
    ELSE
        -- Locked, because two admins saving the same product would otherwise
        -- interleave their matrix writes and leave the two halves of the
        -- save visible to each other. Existence was already checked above,
        -- so this only has to take the lock.
        PERFORM 1 FROM public.products WHERE id = v_id FOR UPDATE;

        UPDATE public.products
        SET slug            = v_slug,
            title           = v_title,
            description     = NULLIF(btrim(COALESCE(p_payload->>'description', '')), ''),
            short_description = v_short_desc,
            category_id     = v_cat_id,
            sub_category_id = v_sub_id,
            regular_price   = v_regular,
            price           = v_sale,
            original_price  = v_regular,
            cost_price      = v_cost,
            tags            = v_tags,
            discount_type   = v_dtype,
            discount_value  = v_dvalue,
            discount_percent = v_discount_pct,
            status          = v_status,
            badge           = NULLIF(btrim(COALESCE(p_payload->>'badge', '')), ''),
            badge_type      = NULLIF(btrim(COALESCE(p_payload->>'badge_type', '')), ''),
            is_featured     = COALESCE((p_payload->>'is_featured')::BOOLEAN, false),
            specs           = COALESCE(p_payload->'specs', '{}'::JSONB),
            updated_at      = now()
        WHERE id = v_id;
    END IF;

    -- ---------- option links
    DELETE FROM public.product_colors WHERE product_id = v_id;
    INSERT INTO public.product_colors (product_id, color_id, sort_order)
    SELECT v_id, u.c, u.ord - 1 FROM unnest(v_color_ids) WITH ORDINALITY AS u(c, ord)
    ON CONFLICT (product_id, color_id) DO NOTHING;

    DELETE FROM public.product_sizes WHERE product_id = v_id;
    INSERT INTO public.product_sizes (product_id, size_id, sort_order)
    SELECT v_id, u.s, u.ord - 1 FROM unnest(v_size_ids) WITH ORDINALITY AS u(s, ord)
    ON CONFLICT (product_id, size_id) DO NOTHING;

    -- ---------- the matrix
    -- A product with colours and/or sizes gets the cartesian product of
    -- them. That is not a convenience: resolve_order_variant() refuses an
    -- ambiguous match, so a product offering three colours and four sizes
    -- needs all twelve rows or a customer who picks "Red / M" cannot be
    -- matched to stock and checkout rejects the order.
    IF COALESCE(array_length(v_color_ids, 1), 0) > 0
       OR COALESCE(array_length(v_size_ids, 1), 0) > 0 THEN

        CREATE TEMP TABLE _wanted ON COMMIT DROP AS
        SELECT
            c.color_id,
            s.size_id,
            COALESCE((
                SELECT v.item->>'stock'
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id
            ), '0')::INTEGER AS stock,
            (SELECT v.item->>'price_override'
               FROM jsonb_array_elements(v_variants) AS v(item)
              WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id
                AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id
            ) AS price_override,
            (SELECT v.item->>'sku'
               FROM jsonb_array_elements(v_variants) AS v(item)
              WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id
                AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id
            ) AS sku,
            COALESCE((SELECT (v.item->>'is_active')::BOOLEAN
               FROM jsonb_array_elements(v_variants) AS v(item)
              WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id
                AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id
            ), true) AS is_active
        FROM unnest(v_color_ids) AS c(color_id)
        CROSS JOIN unnest(v_size_ids) AS s(size_id)
        -- Colours but no sizes: one row per colour.
        --
        -- These two branches were written as literal rows -- 0, NULL, NULL,
        -- true -- which looked like a deliberate default but silently threw
        -- away everything the admin typed. The correlated subqueries were
        -- only present in the cross-product branch above, so a product sold in
        -- three colours and no sizes, or five sizes and no colours, stored
        -- stock 0 and a null SKU on every save no matter what the matrix said.
        -- The UI builds the same one-column table for a single axis, so the
        -- fields were editable and the server ignored them.
        --
        -- The lookups are now identical to the two-axis branch, with the
        -- missing side matched as NULL by IS NOT DISTINCT FROM.
        UNION ALL
        SELECT c.color_id, NULL::TEXT,
               COALESCE((
                   SELECT v.item->>'stock'
                     FROM jsonb_array_elements(v_variants) AS v(item)
                    WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id::TEXT
                      AND (v.item->>'size_id')  IS NOT DISTINCT FROM NULL::TEXT
               ), '0')::INTEGER,
               (SELECT v.item->>'price_override'
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM NULL::TEXT) AS price_override,
               (SELECT v.item->>'sku'
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM NULL::TEXT) AS sku,
               COALESCE((SELECT (v.item->>'is_active')::BOOLEAN
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM c.color_id::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM NULL::TEXT), true) AS is_active
          FROM unnest(v_color_ids) AS c(color_id)
         WHERE array_length(v_size_ids, 1) IS NULL
        -- Sizes but no colours: one row per size.
        UNION ALL
        SELECT NULL::TEXT, s.size_id,
               COALESCE((
                   SELECT v.item->>'stock'
                     FROM jsonb_array_elements(v_variants) AS v(item)
                    WHERE (v.item->>'color_id') IS NOT DISTINCT FROM NULL::TEXT
                      AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id::TEXT
               ), '0')::INTEGER,
               (SELECT v.item->>'price_override'
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM NULL::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id::TEXT) AS price_override,
               (SELECT v.item->>'sku'
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM NULL::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id::TEXT) AS sku,
               COALESCE((SELECT (v.item->>'is_active')::BOOLEAN
                  FROM jsonb_array_elements(v_variants) AS v(item)
                 WHERE (v.item->>'color_id') IS NOT DISTINCT FROM NULL::TEXT
                   AND (v.item->>'size_id')  IS NOT DISTINCT FROM s.size_id::TEXT), true) AS is_active
          FROM unnest(v_size_ids) AS s(size_id)
         WHERE array_length(v_color_ids, 1) IS NULL;

        -- Removed options go, matched on the pair rather than on ids so the
        -- rows that survive keep their identity.
        DELETE FROM public.product_variants pv
        WHERE pv.product_id = v_id
          AND NOT EXISTS (
              SELECT 1 FROM _wanted w
              WHERE w.color_id IS NOT DISTINCT FROM pv.color_id
                AND w.size_id  IS NOT DISTINCT FROM pv.size_id
          );

        -- variant_key is deliberately absent from the column list: it is a
        -- generated column, so writing it is an error rather than a
        -- redundancy. It remains valid as the ON CONFLICT target.
        INSERT INTO public.product_variants (
            product_id, color_id, size_id, sku,
            regular_price_override, stock, is_active
        )
        SELECT v_id, w.color_id, w.size_id,
               NULLIF(btrim(COALESCE(w.sku, '')), ''),
               NULLIF(w.price_override, '')::NUMERIC,
               GREATEST(COALESCE(w.stock, 0), 0),
               COALESCE(w.is_active, true)
        FROM _wanted w
        ON CONFLICT (product_id, variant_key) DO UPDATE SET
            stock                 = EXCLUDED.stock,
            regular_price_override = EXCLUDED.regular_price_override,
            -- A blank SKU in the form means "leave the one I already set",
            -- because an empty field is far more often an unfilled box than
            -- a deliberate request to erase the code.
            sku                   = COALESCE(NULLIF(EXCLUDED.sku, ''), product_variants.sku),
            is_active             = EXCLUDED.is_active,
            updated_at            = now();

        DROP TABLE _wanted;

        -- A new option has no showroom allocation, and an order cannot be
        -- reserved against a variant that has none. Every active showroom
        -- therefore gets a zero row for every variant, which the admin can
        -- then allocate. Existing rows are left alone by the ON CONFLICT.
        INSERT INTO public.product_stock (variant_id, showroom_id, quantity, reserved_quantity, updated_at)
        SELECT v.id, s.id, 0, 0, now()
        FROM public.product_variants v
        CROSS JOIN public.showrooms s
        WHERE v.product_id = v_id AND s.is_active
        ON CONFLICT (variant_id, showroom_id) DO NOTHING;
    ELSE
        -- No options at all: a single unnamed variant. Any matrix left from a
        -- previous save is removed, because a row that survives here would
        -- still resolve at checkout and could be sold after the admin
        -- believed the options were gone.
        DELETE FROM public.product_variants WHERE product_id = v_id;
    END IF;

    -- ---------- promotion links
    SELECT COALESCE(array_agg(DISTINCT t.id::TEXT), ARRAY[]::TEXT[])
    INTO v_promo_ids
    FROM jsonb_array_elements_text(COALESCE(p_payload->'promotion_ids', '[]'::JSONB)) AS t(id)
    JOIN public.promotions pr ON pr.id = t.id;
    IF jsonb_array_length(COALESCE(p_payload->'promotion_ids', '[]'::JSONB))
       <> COALESCE(array_length(v_promo_ids, 1), 0) THEN
        RAISE EXCEPTION 'unknown_promotion' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.promotion_products WHERE product_id = v_id;
    INSERT INTO public.promotion_products (promotion_id, product_id)
    SELECT p, v_id FROM unnest(v_promo_ids) AS p
    ON CONFLICT DO NOTHING;

    -- ---------- project the options back onto the product
    -- The storefront reads products.colors and products.sizes directly, so
    -- both are rebuilt from the canonical tables on every save rather than
    -- typed in. Per-size stock is the total across the colours that size is
    -- offered in, which is what a shopper who picks a size before a colour
    -- is asking about.
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object('name', c.name, 'hex', c.hex) ORDER BY pc.sort_order
    ), '[]'::JSONB)
    INTO v_color_rows
    FROM public.product_colors pc
    JOIN public.colors c ON c.id = pc.color_id
    WHERE pc.product_id = v_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'size', s.display_name,
            'chest', COALESCE((
                SELECT sm.measurements->>'chest'
                  FROM public.size_measurements sm
                 WHERE sm.size_id = s.id AND sm.region_code = 'BD'
                 LIMIT 1
            ), ''),
            'stock', COALESCE((
                SELECT SUM(v.stock) FROM public.product_variants v
                 WHERE v.size_id = s.id AND v.product_id = v_id AND v.is_active
            ), 0)::INTEGER
        ) ORDER BY ps.sort_order
    ), '[]'::JSONB)
    INTO v_size_rows
    FROM public.product_sizes ps
    JOIN public.sizes s ON s.id = ps.size_id
    WHERE ps.product_id = v_id;

    UPDATE public.products
    SET colors            = v_color_rows,
        sizes             = v_size_rows,
        color_palette_ids = v_color_ids
    WHERE id = v_id;

    SELECT jsonb_build_object(
        'id', v_id,
        'slug', v_slug,
        'variant_count', (SELECT count(*)::INTEGER
                          FROM public.product_variants WHERE product_id = v_id),
        'stock', COALESCE((SELECT SUM(stock) FROM public.product_variants
                           WHERE product_id = v_id AND is_active), 0)::INTEGER
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_product(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_product(JSONB) TO authenticated;
