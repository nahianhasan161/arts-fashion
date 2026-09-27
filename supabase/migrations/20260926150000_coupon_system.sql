-- ==========================================================
-- COUPON SYSTEM
--
-- Coupons are a SECOND discount layer on top of promotions:
--
--   regular_price
--     -> standing markdown      (products.discount_*)
--     -> promotion              (REPLACES the markdown, see Phase 7/8)
--     -> coupon                 (STACKS on whatever the promotion produced)
--
-- This is the opposite of promotion semantics on purpose. A promotion
-- already replaces the markdown, so it must never stack. A coupon is
-- entered by a customer at checkout and is explicitly meant to take
-- money off the price they were just quoted, so it stacks.
--
-- Two properties drive the schema:
--
-- 1. GROUP RESTRICTION. A coupon may be scoped to a user group
--    ("VIP", "Students", "Newsletter"). Only members may redeem it.
--    This is a separate table from profiles.role on purpose:
--    profiles.role has CHECK (role IN ('user','admin')), so the
--    segment cannot be expressed there. user_groups is many-to-many
--    via user_group_members, so a user can belong to several.
--
-- 2. NO PUBLIC READ. A group coupon is not enumerable. coupons has no
--    public SELECT policy; every read goes through the SECURITY
--    DEFINER functions below, which decide what the caller may see.
--
-- Money invariants (mirroring the promotion system):
--   - orders.subtotal          = SUM(order_items.unit_price * quantity)
--   - orders.discount_total    = SUM(base_price*qty) - subtotal
--   - orders.total_amount      = subtotal + shipping_fee
--   subtotal and discount_total are both DERIVED from the stored
--   unit_price, never accumulated independently, so they cannot drift.
-- ==========================================================

-- ------------------------------------------------------------
-- 1. User groups (customer segments)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_groups (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Membership. references profiles (not auth.users) because profiles is
-- the app's own user record and already cascades from auth.users.
CREATE TABLE IF NOT EXISTS public.user_group_members (
    group_id     TEXT NOT NULL REFERENCES public.user_groups(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
    assigned_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_group_members_user
    ON public.user_group_members (user_id);

DROP TRIGGER IF EXISTS user_groups_set_updated_at ON public.user_groups;
CREATE TRIGGER user_groups_set_updated_at
    BEFORE UPDATE ON public.user_groups
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Coupons
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    code                TEXT NOT NULL,
    description         TEXT,
    -- NULL means the coupon is public: anyone, including guests, may use it.
    -- A non-NULL group_id makes it member-only.
    group_id            TEXT REFERENCES public.user_groups(id) ON DELETE RESTRICT,
    -- 'order'   -> applies to the whole post-promotion subtotal
    -- 'products' -> applies only to the lines listed in coupon_products
    applies_to          TEXT NOT NULL DEFAULT 'order'
                        CHECK (applies_to IN ('order','products')),
    discount_type       TEXT NOT NULL DEFAULT 'percentage'
                        CHECK (discount_type IN ('flat','percentage')),
    discount_value      NUMERIC(12,2) NOT NULL DEFAULT 0
                        CHECK (discount_value >= 0),
    -- Gate on the post-promotion subtotal, i.e. what the customer sees.
    minimum_order_value NUMERIC(12,2) NOT NULL DEFAULT 0
                        CHECK (minimum_order_value >= 0),
    max_uses            INTEGER,                       -- NULL = unlimited
    -- Enforced for signed-in redeemers only. A guest cannot be counted
    -- per-user, so a public coupon with no max_uses is unlimited to guests.
    max_uses_per_user   INTEGER NOT NULL DEFAULT 1
                        CHECK (max_uses_per_user >= 1),
    starts_at           TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at             TIMESTAMP WITH TIME ZONE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','cancelled')),
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
    -- codes are normalised to upper-case on write
    CONSTRAINT coupons_code_upper   CHECK (code = upper(code)),
    CONSTRAINT coupons_code_format  CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
    CONSTRAINT coupons_window_check CHECK (ends_at > starts_at),
    CONSTRAINT coupons_pct_check
        CHECK (discount_type <> 'percentage' OR discount_value <= 100),
    CONSTRAINT coupons_max_uses_check
        CHECK (max_uses IS NULL OR max_uses >= 1)
);

-- case-insensitive uniqueness, so "vip20" and "VIP20" cannot coexist
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_unique ON public.coupons (upper(code));
CREATE INDEX IF NOT EXISTS idx_coupons_window ON public.coupons (status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_coupons_group  ON public.coupons (group_id);

DROP TRIGGER IF EXISTS coupons_set_updated_at ON public.coupons;
CREATE TRIGGER coupons_set_updated_at
    BEFORE UPDATE ON public.coupons
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.coupon_products (
    coupon_id  TEXT NOT NULL REFERENCES public.coupons(id)  ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    PRIMARY KEY (coupon_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_products_product
    ON public.coupon_products (product_id);

-- ------------------------------------------------------------
-- 3. Redemption ledger
--
-- Written inside create_order_with_reservations(), so a failed order
-- rolls the redemption back with it and usage limits cannot drift.
-- One row per order per coupon (enforced by the unique index).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    coupon_id   TEXT NOT NULL REFERENCES public.coupons(id)  ON DELETE CASCADE,
    user_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    order_id    TEXT NOT NULL REFERENCES public.orders(id)  ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    redeemed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_once_per_order
    ON public.coupon_redemptions (coupon_id, order_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_user
    ON public.coupon_redemptions (coupon_id, user_id);

-- ------------------------------------------------------------
-- 4. Order history snapshots
--
-- coupon_name is a denormalised copy so deleting a coupon never breaks
-- an old invoice, exactly like promotions. ON DELETE SET NULL on the id
-- for the same reason.
-- ------------------------------------------------------------
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS coupon_id             TEXT REFERENCES public.coupons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS coupon_code           TEXT,
    ADD COLUMN IF NOT EXISTS coupon_discount_total NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS coupon_id             TEXT REFERENCES public.coupons(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS coupon_code           TEXT,
    ADD COLUMN IF NOT EXISTS coupon_discount_total NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 5. RLS
--
-- coupons gets NO public read: a member-only code must not be
-- enumerable by anyone. Admin reads are covered by is_admin().
-- ------------------------------------------------------------
ALTER TABLE public.user_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- user_groups: publicly readable so a signed-in shopper can be told
-- which segments they belong to.
DROP POLICY IF EXISTS "Allow public read access to user_groups" ON public.user_groups;
CREATE POLICY "Allow public read access to user_groups"
    ON public.user_groups FOR SELECT USING (TRUE);

-- membership: a user may read their own rows; admins read all
DROP POLICY IF EXISTS "Users can read own group membership" ON public.user_group_members;
CREATE POLICY "Users can read own group membership"
    ON public.user_group_members FOR SELECT
    USING (public.is_admin() OR user_id = auth.uid());

-- coupons: admin only. The storefront reads them via
-- validate_coupon(), which enforces eligibility per caller.
DROP POLICY IF EXISTS "Admins can view coupons" ON public.coupons;
CREATE POLICY "Admins can view coupons"
    ON public.coupons FOR SELECT USING (public.is_admin());

-- coupon_products: admin only, same reasoning as coupons
DROP POLICY IF EXISTS "Admins can view coupon products" ON public.coupon_products;
CREATE POLICY "Admins can view coupon products"
    ON public.coupon_products FOR SELECT USING (public.is_admin());

-- redemptions: a shopper may read their own, for transparency
DROP POLICY IF EXISTS "Users can read own redemptions" ON public.coupon_redemptions;
CREATE POLICY "Users can read own redemptions"
    ON public.coupon_redemptions FOR SELECT
    USING (public.is_admin() OR user_id = auth.uid());
