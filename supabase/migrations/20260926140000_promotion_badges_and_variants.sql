-- ==========================================================
-- Phase 8: promotion-driven badges + variant price overrides
--
-- 1. best_active_promotion()  - the winning-promo rule, extracted
--    so product-level, variant-level and badge queries all share
--    one definition instead of three copies of the LATERAL.
--
-- 2. get_effective_variant_prices() - honours
--    product_variants.regular_price_override, which the product-level
--    function previously ignored.
--
-- 3. get_effective_badges() - derives the storefront discount badge
--    from the live promotion, so products.badge (a static editable
--    string) can no longer outlive the promotion it described.
--    Returns NULL badge fields when no promotion is live, which is the
--    caller's signal to fall back to the manual badge.
-- ==========================================================

-- Format a numeric for display without trailing-zero noise: 30.00 -> 30, 12.50 -> 12.5
CREATE OR REPLACE FUNCTION public.fmt_num(v NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(trim(both '.' FROM
            regexp_replace(
                regexp_replace(to_char(v, 'FM9999999990.00'), '0+$', ''),
                '\.$', ''
            )
        ), ''),
        '0'
    );
$$;

-- The single active promotion that yields the lowest price, provided it
-- actually beats the standing markdown. Returns zero or one row.
CREATE OR REPLACE FUNCTION public.best_active_promotion(
    p_product_id    TEXT,
    p_regular_price NUMERIC,
    p_base_price    NUMERIC
)
RETURNS TABLE (
    promotion_id   TEXT,
    promotion_name TEXT,
    promo_type     TEXT,
    promo_value    NUMERIC,
    promo_price    NUMERIC
)
LANGUAGE sql
STABLE
AS $$
    SELECT q.promotion_id, q.promotion_name, q.promo_type, q.promo_value, q.promo_price
    FROM (
        SELECT p.id        AS promotion_id,
               p.name      AS promotion_name,
               p.discount_type AS promo_type,
               p.discount_value AS promo_value,
               public.calculate_sale_price(
                   p_regular_price, p.discount_type, p.discount_value
               ) AS promo_price
        FROM public.promotions p
        JOIN public.promotion_products pp ON pp.promotion_id = p.id
        WHERE pp.product_id = p_product_id
          AND p.status = 'active'
          AND p.starts_at <= now()
          AND p.ends_at   >  now()
          AND public.calculate_sale_price(
                  p_regular_price, p.discount_type, p.discount_value
              ) < p_base_price
        ORDER BY promo_price ASC, p.discount_value DESC, p.starts_at ASC
        LIMIT 1
    ) q;
$$;

-- Product-level effective pricing, now expressed via best_active_promotion()
CREATE OR REPLACE FUNCTION public.get_effective_prices(p_product_ids TEXT[])
RETURNS TABLE (
    product_id     TEXT,
    regular_price  NUMERIC,
    base_price     NUMERIC,
    final_price    NUMERIC,
    discount_type  TEXT,
    discount_value NUMERIC,
    promotion_id   TEXT,
    promotion_name TEXT,
    source         TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH b AS (
        SELECT pr.id,
               COALESCE(pr.regular_price, pr.original_price, 0) AS regular_price,
               COALESCE(pr.discount_type, 'percentage')          AS p_type,
               COALESCE(pr.discount_value, 0)                   AS p_value
        FROM public.products pr
        WHERE pr.id = ANY(p_product_ids)
    ),
    calc AS (
        SELECT b.*,
               public.calculate_sale_price(b.regular_price, b.p_type, b.p_value) AS base_price
        FROM b
    )
    SELECT c.id                                                 AS product_id,
           c.regular_price,
           c.base_price,
           COALESCE(a.promo_price, c.base_price)               AS final_price,
           COALESCE(a.promo_type, c.p_type)                    AS discount_type,
           COALESCE(a.promo_value, c.p_value)                  AS discount_value,
           a.promotion_id,
           a.promotion_name,
           CASE WHEN a.promotion_id IS NOT NULL THEN 'promotion'
                WHEN c.p_value > 0              THEN 'markdown'
                ELSE 'none' END                                AS source
    FROM calc c
    LEFT JOIN LATERAL public.best_active_promotion(c.id, c.regular_price, c.base_price) a
           ON TRUE;
$$;

-- Variant-level effective pricing. A variant's regular price override wins
-- over the product's regular price; the product's own markdown still applies
-- to the overridden price.
CREATE OR REPLACE FUNCTION public.get_effective_variant_prices(p_variant_ids TEXT[])
RETURNS TABLE (
    variant_id     TEXT,
    product_id     TEXT,
    regular_price  NUMERIC,
    base_price     NUMERIC,
    final_price    NUMERIC,
    discount_type  TEXT,
    discount_value NUMERIC,
    promotion_id   TEXT,
    promotion_name TEXT,
    source         TEXT
)
LANGUAGE sql
STABLE
AS $$
    WITH b AS (
        SELECT v.id AS variant_id,
               v.product_id,
               COALESCE(
                   v.regular_price_override,
                   pr.regular_price,
                   pr.original_price,
                   0
               ) AS regular_price,
               COALESCE(pr.discount_type, 'percentage') AS p_type,
               COALESCE(pr.discount_value, 0)          AS p_value
        FROM public.product_variants v
        JOIN public.products pr ON pr.id = v.product_id
        WHERE v.id = ANY(p_variant_ids)
    ),
    calc AS (
        SELECT b.*,
               public.calculate_sale_price(b.regular_price, b.p_type, b.p_value) AS base_price
        FROM b
    )
    SELECT c.variant_id,
           c.product_id,
           c.regular_price,
           c.base_price,
           COALESCE(a.promo_price, c.base_price)  AS final_price,
           COALESCE(a.promo_type, c.p_type)       AS discount_type,
           COALESCE(a.promo_value, c.p_value)     AS discount_value,
           a.promotion_id,
           a.promotion_name,
           CASE WHEN a.promotion_id IS NOT NULL THEN 'promotion'
                WHEN c.p_value > 0              THEN 'markdown'
                ELSE 'none' END                 AS source
    FROM calc c
    LEFT JOIN LATERAL public.best_active_promotion(c.product_id, c.regular_price, c.base_price) a
           ON TRUE;
$$;

-- Derived storefront badge. NULL badge fields mean "no live promotion",
-- so the caller falls back to products.badge.
CREATE OR REPLACE FUNCTION public.get_effective_badges(p_product_ids TEXT[])
RETURNS TABLE (
    product_id        TEXT,
    badge_label       TEXT,
    badge_type        TEXT,
    discount_percent  INTEGER,
    base_price        NUMERIC,
    final_price       NUMERIC,
    promotion_id      TEXT,
    promotion_name    TEXT
)
LANGUAGE sql
STABLE
AS $$
    SELECT e.product_id,
           COALESCE(
               promo.badge_label,
               CASE WHEN e.discount_type = 'percentage'
                    THEN public.fmt_num(e.discount_value) || '% OFF'
                    ELSE public.fmt_num(e.discount_value) || ' OFF'
               END
           ) AS badge_label,
           'discount'::TEXT AS badge_type,
           CASE WHEN e.discount_type = 'percentage'
                THEN e.discount_value::INTEGER
                ELSE CASE WHEN e.regular_price > 0
                         THEN ROUND((e.regular_price - e.final_price) / e.regular_price * 100)::INTEGER
                         ELSE 0 END
           END AS discount_percent,
           e.base_price,
           e.final_price,
           e.promotion_id,
           e.promotion_name
    FROM public.get_effective_prices(p_product_ids) e
    LEFT JOIN public.promotions promo ON promo.id = e.promotion_id
    WHERE e.promotion_id IS NOT NULL;
$$;

-- Refresh the browse view with badge + variant-aware columns
CREATE OR REPLACE VIEW public.products_with_effective_pricing AS
SELECT pwp.*,
       ep.base_price     AS effective_base_price,
       ep.final_price    AS effective_price,
       ep.discount_type  AS effective_discount_type,
       ep.discount_value AS effective_discount_value,
       ep.promotion_id   AS active_promotion_id,
       ep.promotion_name AS active_promotion_name,
       ep.source         AS price_source,
       -- Derived badge: NULL when no promotion is live, so the client
       -- falls back to the manual products.badge.
       bd.badge_label    AS active_badge_label,
       bd.discount_percent AS active_discount_percent
FROM public.products_with_pricing pwp
LEFT JOIN public.get_effective_prices(ARRAY(SELECT pr.id FROM public.products pr)) ep
       ON ep.product_id = pwp.id
LEFT JOIN public.get_effective_badges(ARRAY(SELECT pr.id FROM public.products pr)) bd
       ON bd.product_id = pwp.id;
