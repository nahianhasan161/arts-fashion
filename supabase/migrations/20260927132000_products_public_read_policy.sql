-- ==========================================================
-- PRODUCTS: PUBLIC READ MUST NOT INCLUDE DRAFTS OR RETIRED ROWS
--
-- 20260927130000 added deleted_at and 20260927130000 also made soft delete
-- the only way a product leaves the table. Both are only real if every read
-- path respects them.
--
-- The read policy was USING (true):
--
--   Allow public read access to products FOR SELECT USING (true)
--
-- which grants the publishable key the entire table. A draft is not merely
-- visible in an admin list, it is fully readable by anyone with the anon key
-- and a REST call: title, cost_price, supplier-facing specifications, the
-- whole row. Filtering that in application code closes the storefront and
-- leaves the table open, which is the same split the media migration already
-- had to fix for storage.objects.
--
-- The policy becomes:
--
--   deleted_at IS NULL                      -- not retired
--   AND (status = 'published' OR is_admin()) -- and either on sale, or you
--                                               are an admin
--
-- The is_admin() arm is what keeps the admin editor working. The admin routes
-- read through a cookie-authenticated server client, so without it every
-- draft would disappear from the editor that exists to write drafts.
--
-- Note the browser also reads products directly through the publishable key
-- (getSupabaseBrowserClient), so this policy is the one that actually governs
-- the storefront rather than the query in services/products.ts. The two now
-- say the same thing, and a mistake in either is not a data leak.
-- ==========================================================

DROP POLICY IF EXISTS "Allow public read access to products" ON public.products;

CREATE POLICY "Allow public read access to products"
    ON public.products
    FOR SELECT
    USING (
        deleted_at IS NULL
        AND (status = 'published' OR public.is_admin())
    );

COMMENT ON POLICY "Allow public read access to products" ON public.products IS
'Shoppers read published, non-retired products only. The is_admin() arm keeps '
'drafts and archived products visible to the admin editor, which reads '
'through a cookie-authenticated client rather than the publishable key.';
