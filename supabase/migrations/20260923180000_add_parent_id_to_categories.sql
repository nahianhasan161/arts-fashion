-- Add parent_id column to categories table for hierarchical structure
-- Migration: 20260923180000

-- Add parent_id column with foreign key reference to categories.id
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL;

-- Create index for faster lookups of subcategories by parent
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);

-- Update existing policies if needed (they should still work with parent_id null)
-- No changes needed - existing policies allow admin CRUD operations