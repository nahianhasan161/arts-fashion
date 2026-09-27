-- ==========================================================
-- SEED: size labels + regional measurement charts
--
-- Letter labels (XS..3XL) are the canonical identity. Each region
-- then presents the same physical size in its own scale:
--   GLOBAL / BD -> centimetres, BD adds a numeric label (36, 38, 40 ...)
--   US          -> inches, letter label
--
-- Values follow the boxy/oversized block already used by the existing
-- product data (a "M" measures ~39-40in flat across the chest).
-- Deterministic ids keep this re-runnable.
-- ==========================================================

-- 1. Size labels
INSERT INTO public.sizes (id, name, display_name, type, fit_type, sort_key, display_order, is_active) VALUES
  ('size-xs',  'XS',  'XS',  'clothing', 'oversized', 1, 1, true),
  ('size-s',   'S',   'S',   'clothing', 'oversized', 2, 2, true),
  ('size-m',   'M',   'M',   'clothing', 'oversized', 3, 3, true),
  ('size-l',   'L',   'L',   'clothing', 'oversized', 4, 4, true),
  ('size-xl',  'XL',  'XL',  'clothing', 'oversized', 5, 5, true),
  ('size-xxl', 'XXL', 'XXL', 'clothing', 'oversized', 6, 6, true),
  ('size-3xl', '3XL', '3XL', 'clothing', 'oversized', 7, 7, true)
ON CONFLICT (id) DO NOTHING;

-- 2. GLOBAL chart (cm, letter labels) - the universal fallback
INSERT INTO public.size_measurements (id, size_id, region_code, category_id, label_override, measurements, display_order) VALUES
  ('sm-xs-global',  'size-xs',  'GLOBAL', NULL, NULL, '{"chest":91,  "length":66}', 1),
  ('sm-s-global',   'size-s',   'GLOBAL', NULL, NULL, '{"chest":97,  "length":69}', 2),
  ('sm-m-global',   'size-m',   'GLOBAL', NULL, NULL, '{"chest":102, "length":71}', 3),
  ('sm-l-global',   'size-l',   'GLOBAL', NULL, NULL, '{"chest":107, "length":74}', 4),
  ('sm-xl-global',  'size-xl',  'GLOBAL', NULL, NULL, '{"chest":112, "length":76}', 5),
  ('sm-xxl-global', 'size-xxl', 'GLOBAL', NULL, NULL, '{"chest":117, "length":79}', 6),
  ('sm-3xl-global', 'size-3xl', 'GLOBAL', NULL, NULL, '{"chest":122, "length":81}', 7)
ON CONFLICT (id) DO NOTHING;

-- 3. BD chart (cm, numeric labels: 36/38/40/42/44/46/48)
INSERT INTO public.size_measurements (id, size_id, region_code, category_id, label_override, measurements, display_order) VALUES
  ('sm-xs-bd',  'size-xs',  'BD', NULL, '36', '{"chest":91,  "length":66}', 1),
  ('sm-s-bd',   'size-s',   'BD', NULL, '38', '{"chest":97,  "length":69}', 2),
  ('sm-m-bd',   'size-m',   'BD', NULL, '40', '{"chest":102, "length":71}', 3),
  ('sm-l-bd',   'size-l',   'BD', NULL, '42', '{"chest":107, "length":74}', 4),
  ('sm-xl-bd',  'size-xl',  'BD', NULL, '44', '{"chest":112, "length":76}', 5),
  ('sm-xxl-bd', 'size-xxl', 'BD', NULL, '46', '{"chest":117, "length":79}', 6),
  ('sm-3xl-bd', 'size-3xl', 'BD', NULL, '48', '{"chest":122, "length":81}', 7)
ON CONFLICT (id) DO NOTHING;

-- 4. US chart (inches, letter labels)
INSERT INTO public.size_measurements (id, size_id, region_code, category_id, label_override, measurements, display_order) VALUES
  ('sm-xs-us',  'size-xs',  'US', NULL, NULL, '{"chest":36, "length":26}', 1),
  ('sm-s-us',   'size-s',   'US', NULL, NULL, '{"chest":38, "length":27}', 2),
  ('sm-m-us',   'size-m',   'US', NULL, NULL, '{"chest":40, "length":28}', 3),
  ('sm-l-us',   'size-l',   'US', NULL, NULL, '{"chest":42, "length":29}', 4),
  ('sm-xl-us',  'size-xl',  'US', NULL, NULL, '{"chest":44, "length":30}', 5),
  ('sm-xxl-us', 'size-xxl', 'US', NULL, NULL, '{"chest":46, "length":31}', 6),
  ('sm-3xl-us', 'size-3xl', 'US', NULL, NULL, '{"chest":48, "length":32}', 7)
ON CONFLICT (id) DO NOTHING;
