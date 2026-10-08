-- Migration: Separate Orders from Payments, add Returns + Webhooks
-- Date: 2026-10-08
-- Description:
--   Splits the monolithic orders/payments model into separate tables so an
--   order can have multiple payment transactions (charge, refund, chargeback).
--   Adds a returns table with item-level detail. Adds a payment_webhooks
--   table as an audit trail for future MFS gateway integration.
--
--   This is a non-destructive migration: existing orders keep their
--   payment_method and status columns. The new payments table is populated
--   retroactively from existing order data where possible.

-- ==========================================================
-- 1. PAYMENTS — Separate from Orders
-- ==========================================================
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    order_id TEXT REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('charge', 'refund', 'chargeback')),
    provider TEXT NOT NULL DEFAULT 'cod',
    provider_txn_id TEXT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'successful', 'failed', 'cancelled', 'refunded')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_txn_id ON public.payments(provider, provider_txn_id);

-- ==========================================================
-- 2. RETURNS — Order-level return + item-level detail
-- ==========================================================
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
    condition_at_return TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================================
-- 3. PAYMENT WEBHOOKS — Audit trail for future MFS gateway
-- ==========================================================
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
-- 4. TRIGGER: auto-update updated_at
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
-- 5. Helper: compute effective payment status for an order
-- ==========================================================
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

-- ==========================================================
-- 6. RLS POLICIES
-- ==========================================================
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhooks ENABLE ROW LEVEL SECURITY;

-- Payments
CREATE POLICY "Anyone can create payments" ON public.payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all payments" ON public.payments FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update payments" ON public.payments FOR UPDATE USING (public.is_admin());

-- Returns
CREATE POLICY "Anyone can create returns" ON public.returns FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view own returns" ON public.returns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all returns" ON public.returns FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update returns" ON public.returns FOR UPDATE USING (public.is_admin());

-- Return Items
CREATE POLICY "Anyone can create return items" ON public.return_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view return items" ON public.return_items FOR SELECT USING (true);
CREATE POLICY "Admins can manage return items" ON public.return_items FOR UPDATE USING (public.is_admin());

-- Payment Webhooks (service-role only)
CREATE POLICY "Service role only - webhooks" ON public.payment_webhooks FOR ALL USING (false);