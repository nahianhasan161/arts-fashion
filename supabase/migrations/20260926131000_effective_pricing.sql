-- ==========================================================
-- Effective pricing: promotion overlay
--
-- A promotion REPLACES the product's standing markdown for the
-- products it covers. It never stacks, and products.price is
-- never mutated.
--
-- Overlap precedence resolves on the LOWEST RESULTING PRICE, not
-- on raw discount_value, so a flat 500 and a 20% compare fairly.
-- A promotion that would not beat the standing markdown is
-- ignored, so a "promotion" can never raise a price.
-- ==========================================================

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
    ),
    best AS (
        SELECT c.id,
               c.regular_price,
               c.base_price,
               c.p_type,
               c.p_value,
               a.promotion_id,
               a.promotion_name,
               a.promo_type,
               a.promo_value,
               a.promo_price
        FROM calc c
        LEFT JOIN LATERAL (
            SELECT p.id       AS promotion_id,
                   p.name     AS promotion_name,
                   p.discount_type AS promo_type,
                   p.discount_value AS promo_value,
                   public.calculate_sale_price(
                       c.regular_price, p.discount_type, p.discount_value
                   ) AS promo_price
            FROM public.promotions p
            JOIN public.promotion_products pp ON pp.promotion_id = p.id
            WHERE pp.product_id = c.id
              AND p.status = 'active'
              AND p.starts_at <= now()
              AND p.ends_at   >  now()
              AND public.calculate_sale_price(
                      c.regular_price, p.discount_type, p.discount_value
                  ) < c.base_price
            ORDER BY promo_price ASC, p.discount_value DESC, p.starts_at ASC
            LIMIT 1
        ) a ON TRUE
    )
    SELECT best.id                                                   AS product_id,
           best.regular_price,
           best.base_price,
           COALESCE(best.promo_price, best.base_price)              AS final_price,
           COALESCE(best.promo_type, best.p_type)                   AS discount_type,
           COALESCE(best.promo_value, best.p_value)                 AS discount_value,
           best.promotion_id,
           best.promotion_name,
           CASE WHEN best.promotion_id IS NOT NULL THEN 'promotion'
                WHEN best.p_value > 0               THEN 'markdown'
                ELSE 'none' END                                     AS source
    FROM best;
$$;

COMMENT ON FUNCTION public.get_effective_prices(TEXT[]) IS
  'Batch effective price for the given products, applying at most one active promotion each.';

-- Single-product convenience wrapper
CREATE OR REPLACE FUNCTION public.get_effective_price(p_product_id TEXT)
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
    SELECT * FROM public.get_effective_prices(ARRAY[p_product_id]);
$$;

-- Browse/list view: wraps the existing products_with_pricing view.
-- get_effective_prices() is invoked once over the whole id set and
-- hash-joined, rather than per row.
CREATE OR REPLACE VIEW public.products_with_effective_pricing AS
SELECT pwp.*,
       ep.base_price     AS effective_base_price,
       ep.final_price    AS effective_price,
       ep.discount_type  AS effective_discount_type,
       ep.discount_value AS effective_discount_value,
       ep.promotion_id   AS active_promotion_id,
       ep.promotion_name AS active_promotion_name,
       ep.source         AS price_source
FROM public.products_with_pricing pwp
LEFT JOIN public.get_effective_prices(ARRAY(SELECT pr.id FROM public.products pr)) ep
       ON ep.product_id = pwp.id;
