-- ------------------------------------------------------------
-- Product price integrity, and badge types for promotions
-- ------------------------------------------------------------
--
-- Two defects are fixed here. Both are silent, which is what made them
-- expensive: nothing errored, the values were simply wrong.
--
-- 1. A product saved without a price became free.
--
--    admin_save_product() reads the payload key `regular_price` and derives
--    the sale price and the crossed-out price from it. The admin form was
--    built for an older two-independent-prices model and sent `price`,
--    `original_price` and `discount_percent` instead. None of those three
--    keys is read by the function, so every one of them fell through to
--    COALESCE(..., 0) and every product created through the form was stored
--    at 0.00 and published as free.
--
--    The function is left alone here, because the form is the side that was
--    wrong and the derived-price model is deliberate. What changes is that
--    the database itself now refuses a non-positive price, so the defect
--    cannot recur through any other caller: a script, a future endpoint, or
--    a hand-written request. The same class of bug is the expensive kind --
--    a missing key that becomes a plausible-looking 0 rather than an error.
--
--    The constraint is added NOT VALID on purpose. Existing rows are not
--    scanned, so a table that already holds a 0-price product does not block
--    the migration, but every INSERT and every UPDATE is still checked from
--    this moment on. Those legacy rows cannot be repaired automatically --
--    the price the admin typed was discarded, not stored, so it does not
--    exist anywhere to be recovered -- and an admin re-saving one from the
--    form must supply a real price, which is the correct outcome.
--
-- 2. A promotion badge could never be anything but a discount badge.
--
--    get_effective_badges() returned the literal 'discount' as badge_type.
--    The product card and the product page both choose their colour from
--    badge_type, so a promotion labelled "Festive" or "New Arrival" rendered
--    in the red discount style. promotions has a badge_label but no
--    badge_type, so there was nothing for the function to return.
--
--    The column is added with the same four values products use, defaulting
--    to 'discount' so every existing promotion keeps the appearance it has
--    today and no badge changes colour until an admin asks for it.

-- ------------------------------------------------------------
-- 1. A price must be positive
-- ------------------------------------------------------------
--
-- `regular_price` is nullable, so NULL is possible as well as 0. Both are
-- refused, because both display as "৳ 0.00" and both make a promotion's
-- base price NULL, which in turn makes the discount percentage uncomputable
-- and silently 0.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_regular_price_positive'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_regular_price_positive
            CHECK (regular_price IS NOT NULL AND regular_price > 0) NOT VALID;
    END IF;
END;
$$;

COMMENT ON CONSTRAINT products_regular_price_positive ON public.products IS
'Refuses a missing or non-positive regular_price. NOT VALID: rows that predate '
'the 2026-09-27 price fix are left in place, but every new or updated row is '
'checked. The price those rows lost was never stored, so it cannot be backfilled.';

-- ------------------------------------------------------------
-- 2. Promotions carry a badge type
-- ------------------------------------------------------------
ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS badge_type TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'promotions_badge_type_check'
    ) THEN
        -- The four values are exactly the ones products.badge_type already
        -- uses, so a single mapping in the UI covers both sources. A
        -- promotion with no type is a discount, which is what the hardcoded
        -- literal in the old function assumed for every promotion.
        ALTER TABLE public.promotions
            ADD CONSTRAINT promotions_badge_type_check
            CHECK (badge_type IS NULL OR badge_type IN ('discount', 'new', 'festive', 'popular'));
    END IF;
END;
$$;

-- Existing rows are left NULL rather than being written to 'discount'. The
-- function coalesces, so behaviour is identical, but a NULL distinguishes
-- "an admin never chose" from "an admin chose discount", which is the
-- difference between a sensible default and a silent assumption.
COMMENT ON COLUMN public.promotions.badge_type IS
'Visual style of the promotion badge. NULL means an admin has not chosen one, '
'and the badge is treated as a discount.';

-- ------------------------------------------------------------
-- 3. get_effective_badges returns the real type
-- ------------------------------------------------------------
--
-- A SQL function, so CREATE OR REPLACE is enough and the signature is
-- unchanged.
CREATE OR REPLACE FUNCTION public.get_effective_badges(p_product_ids text[])
RETURNS TABLE(
    product_id       TEXT,
    badge_label      TEXT,
    badge_type       TEXT,
    discount_percent INTEGER,
    base_price       NUMERIC,
    final_price      NUMERIC,
    promotion_id     TEXT,
    promotion_name   TEXT
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
           -- The one line that was wrong. A promotion with no type falls back
           -- to 'discount', which is what this function returned for every
           -- promotion before, so nothing regresses.
           COALESCE(promo.badge_type, 'discount')::TEXT AS badge_type,
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

-- ------------------------------------------------------------
-- 4. A clean error instead of a constraint violation
-- ------------------------------------------------------------
--
-- The check above raises 23514, whose message is a Postgres sentence that
-- says nothing about which field the admin got wrong. This wrapper turns it
-- into the same named error the rest of the save path raises, so the route
-- maps it to the same 400 with the same code and the form shows the same
-- wording it shows for every other validation failure.
--
-- SECURITY DEFINER and the fixed search_path match every other function in
-- the schema, so the error name cannot be changed by a caller who controls
-- search_path.
CREATE OR REPLACE FUNCTION public.admin_save_product_guarded(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    RETURN public.admin_save_product(p_payload);
EXCEPTION
    -- 23514 is check_violation. The only check a product save can trip is
    -- the price one above, but the name is matched on the message as well so
    -- that a future check on this table does not surface as a 500.
    WHEN check_violation THEN
        IF SQLERRM LIKE '%products_regular_price_positive%' THEN
            RAISE EXCEPTION 'invalid_regular_price' USING ERRCODE = '22023';
        END IF;
        RAISE;
END;
$$;

-- The guard replaces the direct grant: the underlying function stays
-- unreachable so that no caller can bypass the price check by calling
-- admin_save_product directly.
REVOKE ALL ON FUNCTION public.admin_save_product(JSONB) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.admin_save_product_guarded(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_product_guarded(JSONB) TO authenticated;
