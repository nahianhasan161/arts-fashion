-- ==========================================================
-- MEDIA LIBRARY
--
-- A cross-product view of product_images, plus the metadata and
-- folders it needs.
--
-- WHY THERE IS NO media_assets TABLE
--
-- The obvious design is a global `media_assets` table that
-- product_images references. That was rejected deliberately.
--
-- product_images is already the single source of truth, and
-- products.images is a denormalized jsonb projection of it
-- maintained by four triggers. Introducing a second table means a
-- second projection, and a file's product association would have to
-- be kept in sync between them. Any drift means a live product
-- page shows a broken image, because products.images is plain
-- jsonb that no foreign key protects.
--
-- So the library is a VIEW over product_images plus two small
-- tables that carry no product association:
--
--   product_images   one row per file, already the source of truth
--   media_folders    organisational only, never affects the path
--   media_attachments  files uploaded before being attached
--
-- Keeping the "is this file attached, and to what" question in
-- exactly one table is what makes the delete guard in section 6
-- possible.
--
-- The product-scoped path rule from 20260926160000 is untouched.
-- Folders do not move objects in the bucket, so a file can be
-- reorganised freely without invalidating the path guard.
-- ==========================================================

-- ------------------------------------------------------------
-- 1. Metadata columns on product_images
--
-- All nullable and additive. byte_size and mime_type are recorded
-- from the SERVER's magic-byte sniff, never the client's declared
-- content type, because the analytics and the size guard are only
-- trustworthy if the writer cannot lie.
-- ------------------------------------------------------------
ALTER TABLE public.product_images
    ADD COLUMN IF NOT EXISTS file_name TEXT,
    ADD COLUMN IF NOT EXISTS mime_type TEXT,
    ADD COLUMN IF NOT EXISTS byte_size BIGINT,
    ADD COLUMN IF NOT EXISTS width     INTEGER,
    ADD COLUMN IF NOT EXISTS height    INTEGER;

-- file_name defaults to the object's own basename so the library can
-- label every row, including ones created before this migration.
UPDATE public.product_images
SET file_name = split_part(storage_path, '/', 2)
WHERE file_name IS NULL;

-- Existing rows predate the sniffer, so the type is derived from the
-- extension the server itself wrote. This is only for display and
-- analytics; it is never used to decide whether a file may be served.
UPDATE public.product_images pi
SET mime_type = CASE lower(split_part(pi.storage_path, '.', -1))
                    WHEN 'jpg'  THEN 'image/jpeg'
                    WHEN 'jpeg' THEN 'image/jpeg'
                    WHEN 'png'  THEN 'image/png'
                    WHEN 'webp' THEN 'image/webp'
                    WHEN 'avif' THEN 'image/avif'
                END
WHERE pi.mime_type IS NULL;

-- ------------------------------------------------------------
-- 2. Folders
--
-- Organisational only. Moving a file between folders does not
-- touch the bucket, because WordPress-style folder coupling means a
-- rename silently breaks every URL that referenced the object.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_folders (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    name       TEXT NOT NULL,
    parent_id  TEXT REFERENCES public.media_folders(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Sibling names must be unique. The database version is unknown
-- here, so a unique index over COALESCE is used instead of
-- UNIQUE NULLS NOT DISTINCT, which needs PG15.
CREATE UNIQUE INDEX IF NOT EXISTS media_folders_sibling_name_unique
    ON public.media_folders (COALESCE(parent_id, ''), lower(name));

-- The library is an admin surface, so both new tables follow the same
-- rule: a signed-in admin may read and write, a signed-in non-admin may
-- read nothing, and the public may do neither.
--
-- Reads are permitted for authenticated rather than public because the
-- admin client authenticates with a user JWT, not a service-role key, so
-- without the grant its queries would fail. The data is only file names
-- and folder labels, so the grant is not a disclosure. Writes stay behind
-- is_admin() regardless, which is the part that matters.
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read media folders" ON public.media_folders;
DROP POLICY IF EXISTS "Admins manage media folders" ON public.media_folders;

CREATE POLICY "Admins manage media folders"
    ON public.media_folders FOR ALL
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.media_folders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folders TO authenticated;

ALTER TABLE public.product_images
    ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES public.media_folders(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 3. Unattached uploads
--
-- A file uploaded from the library before it is attached to any
-- product. The path prefix is deliberately outside every product
-- folder, so an attachment can never satisfy a product's path rule
-- by accident.
--
-- The table exists so an admin can upload a batch and decide later
-- where it goes. It is a staging area, not a second source of
-- truth: attaching DELETES the row, so a file is never described by
-- two rows at once.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_attachments (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    storage_path TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    byte_size    BIGINT NOT NULL,
    alt_text     TEXT,
    folder_id    TEXT REFERENCES public.media_folders(id) ON DELETE SET NULL,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Two attachments may not share an object, or a delete of one would
-- take out a file the other still points at.
CREATE UNIQUE INDEX IF NOT EXISTS media_attachments_path_unique
    ON public.media_attachments (storage_path);

ALTER TABLE public.media_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage media attachments" ON public.media_attachments;
CREATE POLICY "Admins manage media attachments"
    ON public.media_attachments FOR ALL
    USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.media_attachments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_attachments TO authenticated;

-- ------------------------------------------------------------
-- 4. Indexes for the library's query shapes
--
-- The grid sorts newest-first and filters by mime, folder and
-- size, so each of those is an index rather than a sort.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS product_images_created_idx
    ON public.product_images (created_at DESC);

CREATE INDEX IF NOT EXISTS product_images_mime_idx
    ON public.product_images (mime_type);

CREATE INDEX IF NOT EXISTS product_images_folder_idx
    ON public.product_images (folder_id);

CREATE INDEX IF NOT EXISTS product_images_byte_size_idx
    ON public.product_images (byte_size DESC NULLS LAST);

-- Free-text search over name and alt text. Trigram beats ILIKE's
-- sequential scan once the table is big enough for it to matter;
-- below roughly a thousand rows Postgres will prefer the scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS product_images_file_name_trgm
    ON public.product_images USING gin (file_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS product_images_alt_text_trgm
    ON public.product_images USING gin (alt_text gin_trgm_ops);

-- ------------------------------------------------------------
-- 5. admin_media_stats()
--
-- Aggregate only, so the analytics panel never materialises the
-- table. `without_alt` is the number worth surfacing: it is the
-- actual accessibility and SEO debt.
--
-- byte_size is NULL for rows that predate the column and for any
-- row written before the sniffer ran, so every aggregate treats it
-- as 0 rather than poisoning the sum with NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_media_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    -- Each figure is its own scalar subquery over the same coalesced
    -- view, rather than one big aggregate. A single aggregate would
    -- have to join the base CTE back to the table to get product_id
    -- and end up counting a cross product.
    RETURN jsonb_build_object(
        'total_bytes', (
            SELECT COALESCE(SUM(COALESCE(byte_size, 0)), 0) FROM public.product_images
        ),
        'file_count', (
            SELECT count(*)::INTEGER FROM public.product_images
        ),
        'product_count', (
            SELECT count(DISTINCT product_id)::INTEGER FROM public.product_images
        ),
        'unattached_count', (
            SELECT count(*)::INTEGER FROM public.media_attachments
        ),
        -- The accessibility and SEO debt. Null and empty are treated
        -- as the same missing state, which is what the writer stores.
        'without_alt', (
            SELECT count(*)::INTEGER FROM public.product_images
            WHERE alt_text IS NULL OR btrim(alt_text) = ''
        ),
        'with_alt', (
            SELECT count(*)::INTEGER FROM public.product_images
            WHERE alt_text IS NOT NULL AND btrim(alt_text) <> ''
        ),
        'by_mime', (
            SELECT COALESCE(
                jsonb_object_agg(t.mime, t.n), '{}'::JSONB
            )
            FROM (
                SELECT COALESCE(mime_type, 'unknown') AS mime, count(*)::INTEGER AS n
                FROM public.product_images GROUP BY 1
            ) t
        ),
        'by_size', jsonb_build_object(
            'under_100kb', (SELECT count(*)::INTEGER FROM public.product_images WHERE COALESCE(byte_size, 0) <  102400),
            'under_500kb', (SELECT count(*)::INTEGER FROM public.product_images WHERE COALESCE(byte_size, 0) >= 102400 AND COALESCE(byte_size, 0) <  512000),
            'under_1mb',   (SELECT count(*)::INTEGER FROM public.product_images WHERE COALESCE(byte_size, 0) >=  512000 AND COALESCE(byte_size, 0) < 1048576),
            'over_1mb',    (SELECT count(*)::INTEGER FROM public.product_images WHERE COALESCE(byte_size, 0) >= 1048576)
        ),
        -- NULLS LAST matters: rows predating byte_size would otherwise
        -- sort as if they were the largest files on the site.
        'largest', (
            SELECT COALESCE(jsonb_agg(public.admin_media_item(pi.id)), '[]'::JSONB)
            FROM (
                SELECT id FROM public.product_images
                ORDER BY byte_size DESC NULLS LAST, created_at DESC
                LIMIT 10
            ) pi
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_media_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_media_stats() TO authenticated;

-- ------------------------------------------------------------
-- 6. admin_delete_media()
--
-- The guard that makes a cross-product library safe.
--
-- An image attached to a product cannot be deleted from the library
-- view, because products.images holds its URL as plain jsonb. A
-- dangling entry there is a broken image on a live storefront, which
-- is far worse than a cluttered library. So this refuses and names
-- the products involved, rather than orphaning a file.
--
-- The caller removes the object from the bucket AFTER this returns,
-- because the row is what makes the file meaningful: if the object
-- removal fails, the result is an unreferenced file, which is
-- recoverable, whereas a missing row is not.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_media(p_image_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row   public.product_images%ROWTYPE;
    v_uses  TEXT;
    v_count INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.product_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- The URL is the link between the jsonb projection and the row,
    -- so it is what proves the file is in use.
    SELECT string_agg(DISTINCT p.title, ', ') INTO v_uses
    FROM public.products p
    WHERE p.images ? public.storage_public_url('product-images', v_row.storage_path);

    IF v_uses IS NOT NULL THEN
        RAISE EXCEPTION 'media_in_use:%', v_uses USING ERRCODE = '23503';
    END IF;

    DELETE FROM public.product_images WHERE id = p_image_id;

    -- Deleting the primary promotes a replacement, matching
    -- admin_delete_product_image, so the product never ends up with
    -- no primary while other images remain.
    IF v_row.is_primary THEN
        SELECT count(*) INTO v_count
        FROM public.product_images WHERE product_id = v_row.product_id;

        IF v_count > 0 THEN
            UPDATE public.product_images SET is_primary = TRUE
            WHERE id = (
                SELECT id FROM public.product_images
                WHERE product_id = v_row.product_id
                ORDER BY sort_order ASC, created_at ASC
                LIMIT 1
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('id', p_image_id, 'storage_path', v_row.storage_path);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_media(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_media(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 7. admin_attach_media()
--
-- Moves an attachment onto a product in one transaction, so a file
-- is never described by both tables at once. The existing INSERT
-- trigger rebuilds products.images, so nothing else is needed to
-- keep the storefront correct.
--
-- The path is rewritten into the product's folder, because
-- admin_add_product_image enforces that rule and a rename in the
-- bucket would have to happen outside SQL. The rename is done by the
-- caller before this is called, and this only records it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_attach_media(
    p_attachment_id TEXT,
    p_product_id    TEXT,
    p_alt_text      TEXT DEFAULT NULL,
    p_is_primary    BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_att     public.media_attachments%ROWTYPE;
    v_count   INTEGER;
    v_primary BOOLEAN;
    v_next    INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_att FROM public.media_attachments WHERE id = p_attachment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id) THEN
        RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Same single-segment rule as admin_add_product_image, so an
    -- attachment cannot smuggle a traversal in through the front
    -- door.
    IF v_att.storage_path !~ ('^' || p_product_id || '/[^/]+$') OR v_att.storage_path LIKE '%..%' THEN
        RAISE EXCEPTION 'invalid_storage_path' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (SELECT 1 FROM public.product_images WHERE storage_path = v_att.storage_path) THEN
        RAISE EXCEPTION 'media_already_attached' USING ERRCODE = '23505';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.product_images WHERE product_id = p_product_id;

    IF v_count >= public.product_image_limit() THEN
        RAISE EXCEPTION 'image_limit_reached' USING ERRCODE = '22023';
    END IF;

    SELECT NOT EXISTS (
        SELECT 1 FROM public.product_images WHERE product_id = p_product_id
    ) INTO v_primary;
    v_primary := v_primary OR COALESCE(p_is_primary, FALSE);

    IF v_primary THEN
        UPDATE public.product_images SET is_primary = FALSE
        WHERE product_id = p_product_id AND is_primary;
    END IF;

    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_next
    FROM public.product_images WHERE product_id = p_product_id;

    INSERT INTO public.product_images (
        product_id, storage_path, alt_text, sort_order, is_primary,
        file_name, mime_type, byte_size
    )
    VALUES (
        p_product_id, v_att.storage_path,
        COALESCE(NULLIF(btrim(COALESCE(p_alt_text, '')), ''), v_att.alt_text),
        v_next, v_primary,
        v_att.file_name, v_att.mime_type, v_att.byte_size
    );

    DELETE FROM public.media_attachments WHERE id = p_attachment_id;

    RETURN v_att.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_attach_media(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_attach_media(TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 8. admin_update_media()
--
-- Library-level metadata edits. The RPCs from the previous migration
-- are left alone; this exists so the library has one entry point and
-- the product editor keeps its own.
--
-- NULL means "leave alone", so the library can send only the field
-- the admin actually changed. An empty string clears, which is why
-- alt_text is distinguished from a plain NULL here.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_media(
    p_image_id  TEXT,
    p_alt_text  TEXT DEFAULT NULL,
    p_file_name TEXT DEFAULT NULL,
    p_folder_id TEXT DEFAULT NULL,
    p_clear_folder BOOLEAN DEFAULT false
)
RETURNS JSONB
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

    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.media_folders WHERE id = p_folder_id
    ) THEN
        RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.product_images
    SET alt_text  = CASE WHEN p_alt_text IS NULL THEN alt_text
                         ELSE NULLIF(btrim(p_alt_text), '') END,
        file_name  = COALESCE(NULLIF(btrim(COALESCE(p_file_name, '')), ''), file_name),
        folder_id  = CASE WHEN p_clear_folder THEN NULL
                          ELSE COALESCE(p_folder_id, folder_id) END
    WHERE id = p_image_id;

    RETURN public.admin_media_item(p_image_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_media(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_media(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 8a. admin_record_media_metadata()
--
-- The upload path learns the file's real type, size and dimensions from
-- the magic-byte sniff, but admin_add_product_image() predates the media
-- library and takes none of that. Rather than widen its signature, which
-- would leave an ambiguous overload behind for every existing caller, the
-- metadata is recorded here as a second step.
--
-- Two calls instead of one is the deliberate trade: the row exists before
-- the metadata is attached, so a file that uploads successfully but fails
-- to record still leaves a row the admin can see and delete, instead of a
-- silent orphan in the bucket.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_media_metadata(
    p_image_id  TEXT,
    p_file_name TEXT,
    p_mime_type TEXT,
    p_byte_size BIGINT,
    p_width     INTEGER DEFAULT NULL,
    p_height    INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF p_byte_size IS NULL OR p_byte_size < 0 THEN
        RAISE EXCEPTION 'invalid_byte_size' USING ERRCODE = '22023';
    END IF;

    -- The type is only ever the server's own sniff result, so an
    -- unsupported value is a programming error rather than user input.
    IF p_mime_type IS NULL OR p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif') THEN
        RAISE EXCEPTION 'invalid_mime_type' USING ERRCODE = '22023';
    END IF;

    UPDATE public.product_images
    SET file_name = COALESCE(NULLIF(btrim(COALESCE(p_file_name, '')), ''), file_name),
        mime_type = p_mime_type,
        byte_size = p_byte_size,
        width     = COALESCE(p_width, width),
        height    = COALESCE(p_height, height)
    WHERE id = p_image_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_record_media_metadata(TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_media_metadata(TEXT, TEXT, TEXT, BIGINT, INTEGER, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 8b. admin_detach_media()
--
-- Moves a product image back into the staging area.
--
-- This exists because admin_delete_media() correctly refuses any file a
-- product references, and the sync trigger guarantees that is EVERY
-- product image. Without detach, the library could list files but never
-- remove one, which is not a usable library.
--
-- Detach rather than delete is the right default: the object stays in the
-- bucket, so the operation is reversible and a product losing its last
-- image degrades to the storefront placeholder instead of a broken page.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_detach_media(
    p_image_id TEXT,
    p_folder_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row     public.product_images%ROWTYPE;
    v_others  INTEGER;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.product_images WHERE id = p_image_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'image_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Relocation is optional. Leaving the path alone would keep it inside
    -- the product folder, which is a lie about what the file is, but it is
    -- also harmless because the path is only ever read as an opaque key.
    -- The route moves the object when this is asked to.
    INSERT INTO public.media_attachments (
        storage_path, file_name, mime_type, byte_size, alt_text, folder_id
    )
    VALUES (
        v_row.storage_path,
        COALESCE(v_row.file_name, split_part(v_row.storage_path, '/', -1)),
        COALESCE(v_row.mime_type, 'image/png'),
        COALESCE(v_row.byte_size, 0),
        v_row.alt_text,
        COALESCE(p_folder_id, v_row.folder_id)
    )
    ON CONFLICT (storage_path) DO UPDATE
        SET file_name = EXCLUDED.file_name,
            mime_type = EXCLUDED.mime_type,
            byte_size = EXCLUDED.byte_size,
            alt_text  = EXCLUDED.alt_text;

    DELETE FROM public.product_images WHERE id = p_image_id;

    -- Promote a replacement if the detached row was the primary, so the
    -- product never keeps an image array that points at nothing.
    IF v_row.is_primary THEN
        SELECT count(*) INTO v_others
        FROM public.product_images WHERE product_id = v_row.product_id;

        IF v_others > 0 THEN
            UPDATE public.product_images SET is_primary = TRUE
            WHERE id = (
                SELECT id FROM public.product_images
                WHERE product_id = v_row.product_id
                ORDER BY sort_order ASC, created_at ASC
                LIMIT 1
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'id', p_image_id,
        'storage_path', v_row.storage_path,
        'product_id', v_row.product_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_detach_media(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_detach_media(TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 8c. admin_delete_attachment()
--
-- The library's real delete. An attachment is referenced by no product
-- and by no projection, so removing it cannot break a live page, which
-- is why it needs no equivalent guard.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_attachment(p_attachment_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_row public.media_attachments%ROWTYPE;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM public.media_attachments WHERE id = p_attachment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attachment_not_found' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.media_attachments WHERE id = p_attachment_id;

    RETURN jsonb_build_object('id', p_attachment_id, 'storage_path', v_row.storage_path);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_attachment(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_attachment(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 9. admin_media_item() / admin_media_list()
--
-- One shape for the library's read path, so the grid, the detail
-- panel and the analytics panel cannot disagree about a row.
--
-- The list takes the same filters the toolbar offers and is
-- server-paginated: the grid must not pull the whole table, or a
-- large library becomes unusable long before it becomes large.
-- ------------------------------------------------------------
-- plpgsql rather than a plain SQL function so it can enforce is_admin().
-- It reports in_use, which reveals which products reference a file, so it
-- is admin information even though the image itself is public.
CREATE OR REPLACE FUNCTION public.admin_media_item(p_image_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'id',          pi.id,
        'product_id',  pi.product_id,
        'storage_path',pi.storage_path,
        'url',         public.storage_public_url('product-images', pi.storage_path),
        'file_name',   COALESCE(pi.file_name, split_part(pi.storage_path, '/', -1)),
        'mime_type',   COALESCE(pi.mime_type, 'unknown'),
        'byte_size',   COALESCE(pi.byte_size, 0),
        'width',       pi.width,
        'height',      pi.height,
        'alt_text',    pi.alt_text,
        'sort_order',  pi.sort_order,
        'is_primary',  pi.is_primary,
        'folder_id',   pi.folder_id,
        'created_at',  pi.created_at,
        'in_use',      EXISTS (
            SELECT 1 FROM public.products p
            WHERE p.images ? public.storage_public_url('product-images', pi.storage_path)
        )
    )
    INTO v_result
    FROM public.product_images pi
    WHERE pi.id = p_image_id;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_media_item(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_media_item(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_media_list(
    p_search      TEXT DEFAULT NULL,
    p_mime        TEXT DEFAULT NULL,
    p_folder_id   TEXT DEFAULT NULL,
    p_missing_alt BOOLEAN DEFAULT false,
    p_only_unused BOOLEAN DEFAULT false,
    p_sort        TEXT DEFAULT 'newest',
    p_limit       INTEGER DEFAULT 60,
    p_offset      INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_result JSONB;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    -- One CTE, so the pager's total and its rows are computed over the
    -- same predicate and cannot disagree. A single ORDER BY handles all
    -- four sorts: the inactive keys sort as NULL and the trailing
    -- created_at DESC acts as the tiebreak.
    WITH filtered AS (
        SELECT pi.*
        FROM public.product_images pi
        WHERE (p_search IS NULL OR p_search = ''
               OR pi.file_name ILIKE '%' || p_search || '%'
               OR pi.alt_text ILIKE '%' || p_search || '%')
          AND (p_mime IS NULL OR p_mime = '' OR pi.mime_type = p_mime)
          AND (p_folder_id IS NULL OR p_folder_id = '' OR pi.folder_id = p_folder_id)
          AND (NOT p_missing_alt OR pi.alt_text IS NULL OR btrim(pi.alt_text) = '')
          AND (NOT p_only_unused OR NOT EXISTS (
                SELECT 1 FROM public.products p2
                WHERE p2.images ? public.storage_public_url('product-images', pi.storage_path)
          ))
    ),
    paged AS (
        SELECT * FROM filtered
        ORDER BY
            CASE WHEN p_sort = 'name'   THEN file_name END ASC,
            CASE WHEN p_sort = 'size'   THEN COALESCE(byte_size, 0) END DESC,
            CASE WHEN p_sort = 'oldest' THEN created_at END ASC,
            created_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    )
    SELECT jsonb_build_object(
        'items', COALESCE((
            SELECT jsonb_agg(public.admin_media_item(p.id) ORDER BY
                CASE WHEN p_sort = 'name'   THEN p.file_name END ASC,
                CASE WHEN p_sort = 'size'   THEN COALESCE(p.byte_size, 0) END DESC,
                CASE WHEN p_sort = 'oldest' THEN p.created_at END ASC,
                p.created_at DESC
            )
            FROM paged p
        ), '[]'::JSONB),
        'total', (SELECT count(*)::INTEGER FROM filtered),
        'limit', LEAST(GREATEST(COALESCE(p_limit, 60), 1), 200),
        'offset', GREATEST(COALESCE(p_offset, 0), 0)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_media_list(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_media_list(TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, INTEGER, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 10. Folder management
--
-- Small wrappers so folder writes are admin-checked in SQL rather
-- than only in the route handler.
-- ------------------------------------------------------------
-- The argument order is p_name, p_parent_id, p_folder_id rather than the
-- other way round, so creating a child is save_folder('Spring', <parent>)
-- and updating is save_folder('Spring', <parent>, <folder>). With the id
-- in second position, a caller creating a child silently RENAMED the
-- parent instead, which is the kind of mistake a positional signature
-- should not allow.
--
-- DROPped first because CREATE OR REPLACE refuses to rename a parameter,
-- and an earlier revision of this file used the other order.
DROP FUNCTION IF EXISTS public.admin_save_folder(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_save_folder(
    p_name      TEXT,
    p_parent_id TEXT DEFAULT NULL,
    p_folder_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id   TEXT;
    v_name TEXT := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'folder_name_required' USING ERRCODE = '22023';
    END IF;

    IF p_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.media_folders WHERE id = p_parent_id
    ) THEN
        RAISE EXCEPTION 'parent_folder_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF p_folder_id IS NULL THEN
        v_id := gen_random_uuid()::TEXT;
        INSERT INTO public.media_folders (id, name, parent_id) VALUES (v_id, v_name, p_parent_id);
    ELSE
        v_id := p_folder_id;
        UPDATE public.media_folders SET name = v_name, parent_id = p_parent_id WHERE id = v_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_folder(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_folder(TEXT, TEXT, TEXT) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_delete_folder(p_folder_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    -- Deleting a folder must not delete files. The FK is ON DELETE
    -- SET NULL for exactly this reason: files fall back to the
    -- uncategorised view instead of disappearing with the folder.
    DELETE FROM public.media_folders WHERE id = p_folder_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_folder(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_folder(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 11. Folders on the read path
--
-- The public helper from the previous migration returns the shape
-- the storefront and product editor already depend on, so it is
-- deliberately unchanged. The library reads through
-- admin_media_item instead.
-- ==========================================================
