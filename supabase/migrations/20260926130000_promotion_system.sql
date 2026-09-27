-- ==========================================================
-- PROMOTION SYSTEM
--
-- Time-boxed promotions that overlay a product's standing
-- markdown. A promotion REPLACES the standing markdown for the
-- products it covers; it never stacks and never mutates
-- products.price.
--
-- Reuses the existing calculate_sale_price() for all money math
-- so rounding and the zero floor behave identically everywhere.
-- ==========================================================

-- 1. Promotions
CREATE TABLE IF NOT EXISTS public.promotions (
    id             TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name           TEXT NOT NULL UNIQUE,
    description    TEXT,
    discount_type  TEXT NOT NULL DEFAULT 'percentage'
                   CHECK (discount_type IN ('flat','percentage')),
    discount_value NUMERIC(12,2) NOT NULL DEFAULT 0
                   CHECK (discount_value >= 0),
    starts_at      TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at        TIMESTAMP WITH TIME ZONE NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','cancelled')),
    badge_label    TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    -- half-open window: ends_at is exclusive so back-to-back
    -- promotions never gap or double-count
    CONSTRAINT promotions_window_check CHECK (ends_at > starts_at),
    CONSTRAINT promotions_pct_check
        CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);

-- 2. Product association (many-to-many)
CREATE TABLE IF NOT EXISTS public.promotion_products (
    promotion_id TEXT NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    product_id   TEXT NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
    PRIMARY KEY (promotion_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_promotions_window
    ON public.promotions (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotion_products_product
    ON public.promotion_products (product_id);

DROP TRIGGER IF EXISTS promotions_set_updated_at ON public.promotions;
CREATE TRIGGER promotions_set_updated_at
    BEFORE UPDATE ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Order-line discount snapshot.
--    Without this, editing or expiring a promotion silently rewrites
--    order history. promotion_name is a deliberate denormalised copy
--    so deleting a promotion never breaks an old invoice.
ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS base_price NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS applied_discount_type TEXT
        CHECK (applied_discount_type IN ('flat','percentage')),
    ADD COLUMN IF NOT EXISTS applied_discount_value NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS promotion_id TEXT REFERENCES public.promotions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS promotion_name TEXT;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS discount_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 4. Row Level Security
ALTER TABLE public.promotions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_products ENABLE ROW LEVEL SECURITY;

-- Public read: the storefront needs active promotions to label products
DROP POLICY IF EXISTS "Allow public read access to promotions" ON public.promotions;
CREATE POLICY "Allow public read access to promotions"
    ON public.promotions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public read access to promotion products" ON public.promotion_products;
CREATE POLICY "Allow public read access to promotion products"
    ON public.promotion_products FOR SELECT USING (true);

-- Admin writes. All admin writes additionally go through
-- admin_save_promotion(), which re-checks is_admin() server-side.
DROP POLICY IF EXISTS "Admins can insert promotions" ON public.promotions;
CREATE POLICY "Admins can insert promotions"
    ON public.promotions FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update promotions" ON public.promotions;
CREATE POLICY "Admins can update promotions"
    ON public.promotions FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete promotions" ON public.promotions;
CREATE POLICY "Admins can delete promotions"
    ON public.promotions FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert promotion products" ON public.promotion_products;
CREATE POLICY "Admins can insert promotion products"
    ON public.promotion_products FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete promotion products" ON public.promotion_products;
CREATE POLICY "Admins can delete promotion products"
    ON public.promotion_products FOR DELETE USING (public.is_admin());
