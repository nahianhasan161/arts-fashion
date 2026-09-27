-- Color Management System - Colors table for saved color palettes
-- Migration: 20260925100000

-- Create colors table for saved color palette management
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

-- Enable Row Level Security
ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

-- Create policies for colors
-- Public can read colors (for shop display)
CREATE POLICY "Allow public read access to colors" ON public.colors FOR SELECT USING (true);
-- Admins can manage colors
CREATE POLICY "Admins can insert colors" ON public.colors FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update colors" ON public.colors FOR UPDATE USING (public.is_admin());
CREATE POLICY "Admins can delete colors" ON public.colors FOR DELETE USING (public.is_admin());

-- Add color_palette_ids column to products table (for linking saved color profiles)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color_palette_ids TEXT[] DEFAULT '{}'::text[];

-- Create index for faster color lookups by category
CREATE INDEX IF NOT EXISTS idx_colors_category_id ON public.colors(category_id);
CREATE INDEX IF NOT EXISTS idx_colors_is_global ON public.colors(is_global);
CREATE INDEX IF NOT EXISTS idx_colors_display_order ON public.colors(display_order);