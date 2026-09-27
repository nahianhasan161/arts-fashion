-- ==========================================================
-- SIZE MANAGEMENT SYSTEM
-- Extends the existing `sizes` table (size labels) with
-- regional measurement charts: Global / BD / US
-- ==========================================================

-- 1. Extend existing size label table with explicit ordering + fit type
ALTER TABLE public.sizes
  ADD COLUMN IF NOT EXISTS sort_key INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fit_type TEXT NOT NULL DEFAULT 'standard';

-- 2. Region reference table (seeded, rarely hand-edited)
CREATE TABLE IF NOT EXISTS public.size_regions (
  code          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL CHECK (unit IN ('cm', 'in')),
  label_style   TEXT NOT NULL CHECK (label_style IN ('letter', 'numeric')),
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 3. Regional measurement mapping: size label x region x category
CREATE TABLE IF NOT EXISTS public.size_measurements (
  id             TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  size_id        TEXT NOT NULL REFERENCES public.sizes(id)         ON DELETE CASCADE,
  region_code    TEXT NOT NULL REFERENCES public.size_regions(code) ON DELETE CASCADE,
  category_id    TEXT REFERENCES public.categories(id)             ON DELETE CASCADE,
  label_override TEXT,
  measurements   JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Uniqueness via PARTIAL indexes.
--    A plain UNIQUE(size_id, region_code, category_id) does NOT work here:
--    Postgres treats NULLs as distinct, so unlimited duplicate
--    "all categories" rows could be inserted for the same size+region.
CREATE UNIQUE INDEX IF NOT EXISTS uq_size_measurements_generic
  ON public.size_measurements (size_id, region_code)
  WHERE category_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_size_measurements_scoped
  ON public.size_measurements (size_id, region_code, category_id)
  WHERE category_id IS NOT NULL;

-- 5. Supporting indexes
CREATE INDEX IF NOT EXISTS idx_size_measurements_size   ON public.size_measurements(size_id);
CREATE INDEX IF NOT EXISTS idx_size_measurements_region ON public.size_measurements(region_code);
CREATE INDEX IF NOT EXISTS idx_sizes_active_order       ON public.sizes(is_active, sort_key, display_order);

-- 6. Seed the supported regions
INSERT INTO public.size_regions (code, name, unit, label_style, display_order) VALUES
  ('GLOBAL', 'Global',       'cm', 'letter',  0),
  ('BD',     'Bangladesh',   'cm', 'numeric', 1),
  ('US',     'United States','in',  'letter',  2)
ON CONFLICT (code) DO NOTHING;

-- 7. Row Level Security
ALTER TABLE public.size_regions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.size_measurements ENABLE ROW LEVEL SECURITY;

-- Public read: the storefront size guide needs charts without auth
DROP POLICY IF EXISTS "Allow public read access to size regions" ON public.size_regions;
CREATE POLICY "Allow public read access to size regions"
  ON public.size_regions FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public read access to size measurements" ON public.size_measurements;
CREATE POLICY "Allow public read access to size measurements"
  ON public.size_measurements FOR SELECT USING (true);

-- Admin write
DROP POLICY IF EXISTS "Admins can insert size regions" ON public.size_regions;
CREATE POLICY "Admins can insert size regions"
  ON public.size_regions FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update size regions" ON public.size_regions;
CREATE POLICY "Admins can update size regions"
  ON public.size_regions FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete size regions" ON public.size_regions;
CREATE POLICY "Admins can delete size regions"
  ON public.size_regions FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert size measurements" ON public.size_measurements;
CREATE POLICY "Admins can insert size measurements"
  ON public.size_measurements FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update size measurements" ON public.size_measurements;
CREATE POLICY "Admins can update size measurements"
  ON public.size_measurements FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete size measurements" ON public.size_measurements;
CREATE POLICY "Admins can delete size measurements"
  ON public.size_measurements FOR DELETE USING (public.is_admin());

-- 8. Size labels: public read for the storefront chart, admin writes.
--    `sizes` already had RLS plus a public-read and an "Admins manage sizes"
--    policy in the live database, so these are guarded to stay re-runnable.
DROP POLICY IF EXISTS "Allow public read access to sizes" ON public.sizes;
CREATE POLICY "Allow public read access to sizes"
  ON public.sizes FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can insert sizes" ON public.sizes;
CREATE POLICY "Admins can insert sizes"
  ON public.sizes FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "Admins can update sizes" ON public.sizes;
CREATE POLICY "Admins can update sizes"
  ON public.sizes FOR UPDATE USING (public.is_admin());
DROP POLICY IF EXISTS "Admins can delete sizes" ON public.sizes;
CREATE POLICY "Admins can delete sizes"
  ON public.sizes FOR DELETE USING (public.is_admin());
