-- ==========================================================
-- PRODUCT MEDIA
--
-- The `product-images` bucket and the `product_images` table already
-- existed but were unusable: `storage.objects` had RLS enabled with
-- ZERO policies, so nobody could upload anything. This migration adds
-- the missing pieces.
--
-- TWO SOURCES OF TRUTH, AND WHY
--
--   product_images   normalised source of truth: one row per file,
--                    with alt_text, sort_order and a single primary
--   products.images  a jsonb string[] the storefront already reads
--                    (ProductCard, cart, detail page all use images[0])
--
-- These cannot be merged, because products.images is jsonb on another
-- table and Postgres cannot generate one from the other. So
-- products.images is kept as a PROJECTION of product_images, rebuilt by
-- a trigger on every write.
--
-- A trigger rather than writes inside each RPC on purpose: a trigger
-- cannot be bypassed. Anything that inserts into product_images by any
-- route, including a direct PostgREST call from the admin client, keeps
-- the storefront in sync. Doing it in the RPCs would drift the first
-- time someone used a different path.
--
-- The trigger orders the array primary-first, because the storefront
-- treats images[0] as the main image.
-- ==========================================================

-- ------------------------------------------------------------
-- 1. Public URL construction
--
-- The storage public URL is SUPABASE_URL + /storage/v1/object/public/
-- + bucket + / + path. SQL does not know SUPABASE_URL, and hardcoding
-- it in application code would mean two places to change. So it lives in
-- a one-row settings table that the trigger reads.
--
-- If it is unset the function returns the bare path, which degrades to
-- a visibly broken image rather than an exception during checkout.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.app_settings (key, value)
VALUES ('storage_public_base_url', 'https://khebwqdhucrdfpfadxry.supabase.co/storage/v1/object/public')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- The base URL may be missing if the row was removed by hand, so fall
-- back to the bare path. A visibly broken image beats an exception
-- firing during a customer's checkout.
CREATE OR REPLACE FUNCTION public.storage_public_url(p_bucket TEXT, p_path TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_path IS NULL OR p_path = '' THEN NULL
        ELSE COALESCE(b.value, '') || '/' || p_bucket || '/' || p_path
    END
    FROM (SELECT COALESCE(value, '') AS value
          FROM public.app_settings
          WHERE key = 'storage_public_base_url') b;
$$;

-- ------------------------------------------------------------
-- 2. Keep products.images in step with product_images
--
-- The rebuild is one UPDATE per event rather than a shared helper with a
-- TG_OP branch, because a plpgsql trigger cannot read NEW on DELETE and
-- branching on TG_OP inside one body is harder to follow than three
-- small functions.
--
-- The trigger orders the array primary-first, because the storefront
-- treats images[0] as the main image.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_product_images_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    UPDATE public.products p
    SET images = (
            SELECT COALESCE(jsonb_agg(
                public.storage_public_url('product-images', pi.storage_path)
                ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
            ), '[]'::JSONB)
            FROM public.product_images pi
            WHERE pi.product_id = NEW.product_id
        ),
        updated_at = now()
    WHERE p.id = NEW.product_id;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_product_images_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    UPDATE public.products p
    SET images = (
            SELECT COALESCE(jsonb_agg(
                public.storage_public_url('product-images', pi.storage_path)
                ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
            ), '[]'::JSONB)
            FROM public.product_images pi
            WHERE pi.product_id = OLD.product_id
        ),
        updated_at = now()
    WHERE p.id = OLD.product_id;
    RETURN NULL;
END;
$$;

-- Reassignment and primary/sort changes only need the row's own product
-- rebuilt, which is the same statement as the insert case.
DROP TRIGGER IF EXISTS product_images_sync_insert ON public.product_images;
CREATE TRIGGER product_images_sync_insert
    AFTER INSERT ON public.product_images
    FOR EACH ROW EXECUTE FUNCTION public.sync_product_images_insert();

DROP TRIGGER IF EXISTS product_images_sync_update ON public.product_images;
CREATE TRIGGER product_images_sync_update
    AFTER UPDATE ON public.product_images
    FOR EACH ROW EXECUTE FUNCTION public.sync_product_images_insert();

DROP TRIGGER IF EXISTS product_images_sync_delete ON public.product_images;
CREATE TRIGGER product_images_sync_delete
    AFTER DELETE ON public.product_images
    FOR EACH ROW EXECUTE FUNCTION public.sync_product_images_delete();

-- Reassigning an image to another product would otherwise leave the old
-- product's array stale. Redirects happen, so cover it.
CREATE OR REPLACE FUNCTION public.sync_product_images_reassign()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
        UPDATE public.products p
        SET images = (
                SELECT COALESCE(jsonb_agg(
                    public.storage_public_url('product-images', pi.storage_path)
                    ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
                ), '[]'::JSONB)
                FROM public.product_images pi
                WHERE pi.product_id = OLD.product_id
            ),
            updated_at = now()
        WHERE p.id = OLD.product_id;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_images_sync_reassign ON public.product_images;
CREATE TRIGGER product_images_sync_reassign
    AFTER UPDATE ON public.product_images
    FOR EACH ROW
    WHEN (OLD.product_id IS DISTINCT FROM NEW.product_id)
    EXECUTE FUNCTION public.sync_product_images_reassign();

-- ------------------------------------------------------------
-- 3. Storage policies
--
-- The bucket is public, so storefront reads are served by the public
-- endpoint and need no SELECT policy. Only writes are missing, and
-- those must be admin-only AND scoped to this bucket, or any signed-in
-- user could write into any bucket on the project.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Admins upload to product-images" ON storage.objects;
CREATE POLICY "Admins upload to product-images"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "Admins update product-images objects" ON storage.objects;
CREATE POLICY "Admins update product-images objects"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'product-images' AND public.is_admin())
    WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "Admins delete product-images objects" ON storage.objects;
CREATE POLICY "Admins delete product-images objects"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'product-images' AND public.is_admin());

-- Listing needs SELECT. Scoped to this bucket, which is already public.
DROP POLICY IF EXISTS "Read product-images objects" ON storage.objects;
CREATE POLICY "Read product-images objects"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'product-images');

-- ------------------------------------------------------------
-- 4. Limits
--
-- The bucket caps a single file at 5MB. Cap the count per product too,
-- so one product cannot consume the whole bucket. Enforced in the RPC
-- because a CHECK constraint cannot count sibling rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.product_image_limit()
RETURNS INTEGER
LANGUAGE sql STABLE AS $$ SELECT 12 $$;

-- ------------------------------------------------------------
-- 5. admin_add_product_image()
--
-- Records an already-uploaded object. The file itself is uploaded via
-- the Storage API from the route handler, because SQL cannot stream a
-- multipart body.
--
-- Returns the new row id. The caller is responsible for deleting the
-- uploaded object if this raises, which the route does.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_add_product_image(
    p_product_id TEXT,
    p_storage_path TEXT,
    p_alt_text TEXT DEFAULT '',
    p_is_primary BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id       TEXT := gen_random_uuid()::TEXT;
    v_path     TEXT := NULLIF(btrim(COALESCE(p_storage_path, '')), '');
    v_count    INTEGER;
    v_primary  BOOLEAN;
    v_next     INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_path IS NULL THEN
        RAISE EXCEPTION 'storage_path_required' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The object must live in this product's folder, as exactly one more
    -- path segment.
    --
    -- Without the folder check an admin could point a row at another
    -- product's file, and the delete path would then remove an unrelated
    -- image. The single-segment rule is what stops a traversal: a prefix
    -- test alone still accepts "pm-1/../../etc/passwd", because that string
    -- does start with "pm-1/".
    IF v_path !~ ('^' || p_product_id || '/[^/]+$') OR v_path LIKE '%..%' THEN
        RAISE EXCEPTION 'invalid_storage_path' USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.product_images
    WHERE product_id = p_product_id;

    IF v_count >= public.product_image_limit() THEN
        RAISE EXCEPTION 'image_limit_reached' USING ERRCODE = '22023';
    END IF;

    -- The first image of a product is always primary, whatever the
    -- caller asked for: the storefront reads images[0] and an empty
    -- array means no product image at all.
    SELECT NOT EXISTS (
        SELECT 1 FROM public.product_images WHERE product_id = p_product_id
    )
    INTO v_primary;
    v_primary := v_primary OR COALESCE(p_is_primary, FALSE);

    IF v_primary THEN
        -- product_images_primary_unique permits only one primary row, so
        -- clear the incumbent in the same transaction.
        UPDATE public.product_images
        SET is_primary = FALSE
        WHERE product_id = p_product_id AND is_primary;
    END IF;

    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_next
    FROM public.product_images
    WHERE product_id = p_product_id;

    INSERT INTO public.product_images (id, product_id, storage_path, alt_text, sort_order, is_primary)
    VALUES (v_id, p_product_id, v_path, NULLIF(btrim(COALESCE(p_alt_text, '')), ''), v_next, v_primary);

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_product_image(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_product_image(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 6. admin_update_product_image()
--
-- Covers alt text, sort position and the primary flag. Passing NULL
-- leaves a field untouched, so a caller can set the primary without
-- resending the alt text it does not have loaded.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_product_image(
    p_image_id     TEXT,
    p_alt_text     TEXT DEFAULT NULL,
    p_sort_order   INTEGER DEFAULT NULL,
    p_is_primary   BOOLEAN DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row public.product_images%ROWTYPE;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.product_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF COALESCE(p_is_primary, FALSE) THEN
        UPDATE public.product_images
        SET is_primary = FALSE
        WHERE product_id = v_row.product_id AND id <> p_image_id AND is_primary;
    END IF;

    UPDATE public.product_images
    SET alt_text   = CASE WHEN p_alt_text IS NULL THEN alt_text
                          ELSE NULLIF(btrim(p_alt_text), '') END,
        sort_order = COALESCE(p_sort_order, sort_order),
        is_primary = COALESCE(p_is_primary, is_primary)
    WHERE id = p_image_id;

    RETURN p_image_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_product_image(TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_product_image(TEXT, TEXT, INTEGER, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 7. admin_set_primary_product_image()
--
-- Separate from the generic update because promoting a primary has to
-- demote the incumbent atomically, and a client that only wants to
-- promote should not have to reason about the other fields.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_primary_product_image(p_image_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row public.product_images%ROWTYPE;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.product_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.product_images SET is_primary = FALSE
    WHERE product_id = v_row.product_id AND is_primary AND id <> p_image_id;

    UPDATE public.product_images SET is_primary = TRUE WHERE id = p_image_id;

    -- Primary sorts first in products.images, so pin it to 0 to keep
    -- the projection stable regardless of the old sort values.
    UPDATE public.product_images SET sort_order = 0 WHERE id = p_image_id;

    RETURN p_image_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_primary_product_image(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_primary_product_image(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 8. admin_reorder_product_images()
--
-- One statement for the whole order, so the storefront can never observe
-- a partially reordered array.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reorder_product_images(
    p_product_id TEXT,
    p_image_ids  TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_pos INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Ignore ids belonging to another product rather than moving them.
    FOR v_pos IN
        SELECT generate_subscripts(p_image_ids, 1)
    LOOP
        UPDATE public.product_images
        SET sort_order = v_pos - 1
        WHERE id = p_image_ids[v_pos]
          AND product_id = p_product_id;
    END LOOP;

    RETURN jsonb_build_object('reordered', COALESCE(array_length(p_image_ids, 1), 0));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reorder_product_images(TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reorder_product_images(TEXT, TEXT[]) TO authenticated;

-- ------------------------------------------------------------
-- 9. admin_delete_product_image()
--
-- Returns the storage_path so the caller can remove the object from the
-- bucket. The file is NOT deleted here: SQL has no access to the object
-- store through the Storage API, and a half-deleted pair (row gone, file
-- kept) is recoverable whereas the reverse is a broken image.
--
-- Deleting the primary promotes a replacement, because a product with no
-- primary has images[0] pointing at an arbitrary image.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_product_image(p_image_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row    public.product_images%ROWTYPE;
    v_path   TEXT;
    v_picked TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.product_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;

    v_path := v_row.storage_path;

    DELETE FROM public.product_images WHERE id = p_image_id;

    IF v_row.is_primary THEN
        SELECT id INTO v_picked
        FROM public.product_images
        WHERE product_id = v_row.product_id
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1;

        IF v_picked IS NOT NULL THEN
            UPDATE public.product_images SET is_primary = TRUE WHERE id = v_picked;
        END IF;
    END IF;

    RETURN jsonb_build_object('id', p_image_id, 'storage_path', v_path);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_product_image(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_product_image(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 10. Public read helper
--
-- One query for the storefront, ordered the same way the projection is,
-- so the admin grid and the product page never disagree about which
-- image is primary.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_product_images(p_product_ids TEXT[])
RETURNS TABLE (
    image_id     TEXT,
    product_id   TEXT,
    url          TEXT,
    alt_text     TEXT,
    sort_order   INTEGER,
    is_primary   BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
    SELECT pi.id,
           pi.product_id,
           public.storage_public_url('product-images', pi.storage_path),
           pi.alt_text,
           pi.sort_order,
           pi.is_primary
    FROM public.product_images pi
    WHERE pi.product_id = ANY(p_product_ids)
    ORDER BY pi.product_id, pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_images(TEXT[]) TO anon, authenticated;
