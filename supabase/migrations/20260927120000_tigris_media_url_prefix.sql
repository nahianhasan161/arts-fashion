-- ------------------------------------------------------------
-- Repoint the media URL projection at Tigris
-- ------------------------------------------------------------
--
-- Products do not store a URL column. `products.images` is a jsonb array of
-- URL strings rebuilt by a trigger, and every read path -- the media library
-- listing, the "is this path in use" guard, the unattached listing -- derives
-- its URL by calling public.storage_public_url() at read time. So there is
-- exactly one place that decides what a stored object looks like from the
-- outside, and this migration changes it.
--
-- The change is deliberately one function. storage_public_url() is called from
-- eleven places spread across three already-applied migrations; redefining it
-- keeps every one of them correct, including the guards that compare a
-- projected URL against a path to decide whether an image is still in use. A
-- partial change here would leave those guards matching against Supabase URLs
-- while the projection emitted Tigris ones, and every in-use image would look
-- detachable.
--
-- Why a prefix rather than a base URL and a bucket
-- -------------------------------------------------
-- The old signature was storage_public_url(bucket, path) and it assembled
-- base + bucket + path. That shape can express a Supabase URL and a Tigris
-- public URL, but not a same-origin path like /api/media/<path>, because
-- there is no bucket segment to absorb. Until the Tigris bucket can be made
-- public -- which needs a verified payment method on the account -- the app
-- serves objects through its own route, and the projection has to say so.
--
-- So the setting is now the complete prefix and the bucket argument is no
-- longer part of the URL. It is kept in the signature so the eleven existing
-- call sites keep working unchanged; callers pass the bucket name for their
-- own readability and it is no longer read. Dropping the parameter would mean
-- editing three applied migrations for no behavioural gain.
--
-- Switching to direct Tigris URLs later
-- -------------------------------------
--   UPDATE public.app_settings SET value = 'https://t3.storage.dev/artsfashion-media'
--    WHERE key = 'media_url_prefix';
--   UPDATE public.products SET images = images;   -- or just re-save each product
--
-- Do that only after the bucket reads anonymously with a 200. Verify with:
--   node scripts/tigris-setup.mjs
-- and set TIGRIS_STORAGE_PUBLIC=true at the same time, so the application and
-- the database agree on the shape. A database pointed at Tigris while the app
-- still proxies is the mismatch to avoid: both produce working images, so
-- nothing fails loudly, but half the traffic goes through the app for no
-- reason.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
    'media_url_prefix',
    -- Same-origin, because the bucket is private until a payment method is
    -- verified. Matches TIGRIS_STORAGE_PUBLIC=false, which is what
    -- publicUrlFor() in src/lib/media/storage.ts returns for the same reason.
    '/api/media',
    now()
)
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = now();

COMMENT ON TABLE public.app_settings IS
'Runtime configuration the database needs. media_url_prefix is prepended to an '
'object path to produce the URL a browser fetches. It is the database half of '
'the TIGRIS_STORAGE_PUBLIC decision; the two must be set together or images '
'will be built in one shape and served in another.';

CREATE OR REPLACE FUNCTION public.storage_public_url(p_bucket TEXT, p_path TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        WHEN p_path IS NULL OR p_path = '' THEN NULL
        ELSE COALESCE((
            SELECT value FROM public.app_settings WHERE key = 'media_url_prefix'
        ), '') || '/' || ltrim(p_path, '/')
    END;
$$;

COMMENT ON FUNCTION public.storage_public_url(TEXT, TEXT) IS
'Builds the public URL for a stored object from media_url_prefix. p_bucket is '
'retained for call-site compatibility and is not read: the prefix already '
'identifies the bucket.';

-- ------------------------------------------------------------
-- Repoint the existing projection
-- ------------------------------------------------------------
--
-- products.images is a materialised copy, so changing the function does not
-- change what is already stored. Every product that has media is rebuilt with
-- the same expression and ordering the trigger uses, rather than by poking a
-- column to fire the trigger, so the result does not depend on whether an
-- UPDATE that changes nothing is treated as a change.
--
-- Safe to run repeatedly.
UPDATE public.products p
SET images = (
        SELECT COALESCE(jsonb_agg(
            public.storage_public_url('artsfashion-media', pi.storage_path)
            ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
        ), '[]'::JSONB)
        FROM public.product_images pi
        WHERE pi.product_id = p.id
    )
WHERE EXISTS (SELECT 1 FROM public.product_images pi WHERE pi.product_id = p.id);
