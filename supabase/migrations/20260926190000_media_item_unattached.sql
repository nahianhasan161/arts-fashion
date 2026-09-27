-- Media library: make `unattached` an explicit part of the item shape.
--
-- admin_media_item() is the only thing that shapes a library item, and it
-- emitted `in_use` but not `unattached`. The client therefore had to treat
-- a MISSING key as "false", which works only because JavaScript treats
-- undefined as falsy. The TypeScript type declares `unattached: boolean`
-- on every item, so the payload did not match its own declared contract,
-- and the staged and library items were distinguished by the presence of
-- a key rather than by its value.
--
-- Every row reachable from admin_media_item() lives in product_images, so
-- it is attached to a product by definition. Staged files are shaped by a
-- different function, which sets it to true. Emitting the key here makes
-- the two comparable with `=== false` and removes the missing-key
-- subtlety from the client's reasoning.

CREATE OR REPLACE FUNCTION public.admin_media_item(p_image_id TEXT)
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
        'unattached',  FALSE,
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
