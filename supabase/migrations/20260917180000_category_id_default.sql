-- ==========================================================
-- MIGRATION: Add UUID default to categories.id
-- ==========================================================

ALTER TABLE public.categories
  ALTER COLUMN id SET DEFAULT uuid_generate_v4()::text;
