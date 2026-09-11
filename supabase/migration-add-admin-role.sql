-- ==========================================================
-- MIGRATION: Add role column and admin RLS policies
-- Run this in Supabase SQL Editor if you already have the tables created
-- ==========================================================

-- 1. Add role column to profiles (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN role TEXT DEFAULT 'user' NOT NULL CHECK (role IN ('user', 'admin'));
    END IF;
END $$;

-- 2. Create is_admin() helper function
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

-- 3. Update handle_new_user to include role
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

-- 4. Admin RLS Policies for Categories
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE USING (public.is_admin());

-- 5. Admin RLS Policies for Products
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE USING (public.is_admin());

-- 6. Admin RLS Policies for Profiles
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (public.is_admin());

-- 7. Admin RLS Policies for Orders
CREATE POLICY "Admins can view all orders" ON public.orders FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins can update all orders" ON public.orders FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete orders" ON public.orders FOR DELETE USING (public.is_admin());

-- 8. Admin RLS Policies for Order Items
CREATE POLICY "Admins can update order items" ON public.order_items FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete order items" ON public.order_items FOR DELETE USING (public.is_admin());
