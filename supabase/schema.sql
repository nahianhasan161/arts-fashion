-- ==========================================================
-- ARTS FASHION E-COMMERCE DATABASE SCHEMA (SUPABASE / POSTGRESQL)
-- ==========================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    parent_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    "group" TEXT DEFAULT 'topwear',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    sub_category TEXT,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL,
    original_price NUMERIC(10, 2) NOT NULL,
    discount_percent INTEGER DEFAULT 0,
    images JSONB DEFAULT '[]'::jsonb,
    colors JSONB DEFAULT '[]'::jsonb,
    sizes JSONB DEFAULT '[]'::jsonb,
    stock INTEGER DEFAULT 0,
    rating NUMERIC(2, 1) DEFAULT 5.0,
    reviews_count INTEGER DEFAULT 0,
    badge TEXT,
    badge_type TEXT,
    is_featured BOOLEAN DEFAULT false,
    specs JSONB DEFAULT '{}'::jsonb,
    color_palette_ids TEXT[] DEFAULT '{}'::text[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3a. Colors Table (Saved color palette for visual consistency)
CREATE TABLE IF NOT EXISTS public.colors (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name TEXT NOT NULL,
    hex TEXT NOT NULL,
    category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
    is_global BOOLEAN DEFAULT false,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Customer Profiles (Linked with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    avatar_url TEXT,
    role TEXT DEFAULT 'user' NOT NULL CHECK (role IN ('user', 'admin')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Helper function: Check if the current authenticated user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$;

-- Helper function: Compute the effective payment status for an order.
-- Returns 'unpaid' if no successful charge, 'partially_refunded' if
-- some money came back, 'fully_refunded' if all money returned, or
-- 'paid' if the charge is still intact.
CREATE OR REPLACE FUNCTION public.order_payment_status(p_order_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_charged NUMERIC := 0;
    v_refunded NUMERIC := 0;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO v_charged
    FROM public.payments
    WHERE order_id = p_order_id
      AND type = 'charge'
      AND status = 'successful';

    SELECT COALESCE(SUM(amount), 0) INTO v_refunded
    FROM public.payments
    WHERE order_id = p_order_id
      AND type = 'refund'
      AND status IN ('successful', 'refunded');

    IF v_charged = 0 THEN
        RETURN 'unpaid';
    ELSIF v_refunded >= v_charged THEN
        RETURN 'fully_refunded';
    ELSIF v_refunded > 0 THEN
        RETURN 'partially_refunded';
    ELSE
        RETURN 'paid';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
        COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture'),
        'user'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    delivery_address TEXT NOT NULL,
    city TEXT NOT NULL,
    subtotal NUMERIC(10, 2) NOT NULL,
    shipping_fee NUMERIC(10, 2) NOT NULL,
    total_amount NUMERIC(10, 2) NOT NULL,
    payment_method TEXT DEFAULT 'cod' NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Order Items Table
CREATE TABLE IF NOT EXISTS public.order_items (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    product_id TEXT NOT NULL,
    title TEXT NOT NULL,
    size TEXT NOT NULL,
    color TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    image TEXT
);

-- ==========================================================
-- 7. PAYMENTS — Separate from Orders
-- ==========================================================
-- An order can have MULTIPLE payment transactions (partial payments,
-- splits, refunds, re-charges). Each row is one atomic transaction.
-- The `type` column distinguishes the lifecycle phase:
--   charge   — original payment attempt
--   refund   — money returned to customer (full or partial)
--   chargeback — gateway-initiated reversal
--
-- `provider` is the MFS gateway name (cod, bkash, nagad, stripe, …).
-- `provider_txn_id` is the gateway's own reference — null until the
-- gateway confirms the transaction. This is the bridge to future
-- automated MFS integration.
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('charge', 'refund', 'chargeback')),
    provider TEXT NOT NULL DEFAULT 'cod',
    provider_txn_id TEXT,                      -- gateway reference (null for COD)
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'successful', 'failed', 'cancelled', 'refunded')),
    metadata JSONB DEFAULT '{}'::jsonb,        -- gateway payload, receipt data, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for looking up all transactions for an order
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
-- Index for gateway callback lookup by provider_txn_id
CREATE INDEX IF NOT EXISTS idx_payments_provider_txn_id ON public.payments(provider, provider_txn_id);

-- ==========================================================
-- 8. RETURNS — Order-level return + item-level detail
-- ==========================================================
-- A return can be partial (some items) or full (all items).
-- Each return has its own status and a refund amount that maps back
-- to a `payments` row of type='refund'.
CREATE TABLE IF NOT EXISTS public.returns (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'received', 'completed', 'rejected')),
    refund_amount NUMERIC(10, 2) DEFAULT 0,
    refund_payment_id TEXT REFERENCES public.payments(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.return_items (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    return_id TEXT REFERENCES public.returns(id) ON DELETE CASCADE NOT NULL,
    order_item_id TEXT REFERENCES public.order_items(id) ON DELETE CASCADE NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    condition_at_return TEXT,                  -- e.g. 'unopened', 'opened', 'damaged'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================
-- 9. PAYMENT WEBHOOKS — Audit trail for future MFS gateway
-- ==========================================================
-- When the MFS gateway calls our webhook, we record the raw payload
-- here BEFORE processing. This gives us an immutable audit trail and
-- lets us retry/replay failed webhook deliveries.
CREATE TABLE IF NOT EXISTS public.payment_webhooks (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    provider_event_id TEXT,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================
-- 10. TRIGGER: auto-update updated_at on payments/returns
-- ==========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_returns_updated_at ON public.returns;
CREATE TRIGGER trg_returns_updated_at
    BEFORE UPDATE ON public.returns
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==========================================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================================

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhooks ENABLE ROW LEVEL SECURITY;

-- ---- Colors ----
-- Admins can manage colors
CREATE POLICY "Allow public read access to colors" ON public.colors FOR SELECT USING (true);
CREATE POLICY "Admins can insert colors" ON public.colors FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update colors" ON public.colors FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete colors" ON public.colors FOR DELETE USING (public.is_admin());

-- ---- Categories ----
-- Public can view categories
CREATE POLICY "Allow public read access to categories" ON public.categories FOR SELECT USING (true);
-- Admins can manage categories
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE USING (public.is_admin());

-- ---- Products ----
-- Public can view products
CREATE POLICY "Allow public read access to products" ON public.products FOR SELECT USING (true);
-- Admins can manage products
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE USING (public.is_admin());

-- ---- Profiles ----
-- Users can manage their own profile
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.is_admin());
-- Admins can update any profile (e.g. role changes)
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (public.is_admin());

-- ---- Orders ----
-- Anyone can insert orders (guest or auth)
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id OR auth.uid() IS NULL);
-- Admins can view and update all orders
CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update all orders" ON public.orders FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE USING (public.is_admin());

-- ---- Order Items ----
CREATE POLICY "Anyone can create order items" ON public.order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view order items" ON public.order_items FOR SELECT USING (true);
CREATE POLICY "Admins can manage order items" ON public.order_items FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete order items" ON public.order_items FOR DELETE USING (public.is_admin());

-- ---- Payments ----
CREATE POLICY "Anyone can create payments" ON public.payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all payments" ON public.payments FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update payments" ON public.payments FOR UPDATE USING (public.is_admin());

-- ---- Returns ----
CREATE POLICY "Anyone can create returns" ON public.returns FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own returns" ON public.returns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all returns" ON public.returns FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update returns" ON public.returns FOR UPDATE USING (public.is_admin());

-- ---- Return Items ----
CREATE POLICY "Anyone can create return items" ON public.return_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view return items" ON public.return_items FOR SELECT USING (true);
CREATE POLICY "Admins can manage return items" ON public.return_items FOR UPDATE USING (public.is_admin());

-- ---- Payment Webhooks ----
CREATE POLICY "Service role only - webhooks" ON public.payment_webhooks FOR ALL USING (false);
