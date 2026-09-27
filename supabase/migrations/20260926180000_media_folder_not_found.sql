-- Media library: report a missing folder instead of silently succeeding.
--
-- admin_delete_folder issued a DELETE that matched nothing and returned
-- success, so a request for a folder that does not exist was reported as
-- a successful delete. That is the one outcome a caller cannot act on: the
-- UI would drop the row from its list and tell the admin it worked, while
-- the folder it meant to remove was never there. Callers cannot detect it
-- from the return value, because the function returns VOID.
--
-- The fix is in SQL because the route cannot see the row count: the RPC
-- is the only layer that knows whether anything matched.

CREATE OR REPLACE FUNCTION public.admin_delete_folder(p_folder_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_found BOOLEAN;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    -- Deleting a folder must not delete files. The FK is ON DELETE
    -- SET NULL for exactly this reason: files fall back to the
    -- uncategorised view instead of disappearing with the folder.
    DELETE FROM public.media_folders WHERE id = p_folder_id RETURNING TRUE INTO v_found;

    IF v_found IS NULL THEN
        RAISE EXCEPTION 'folder_not_found' USING ERRCODE = 'P0002';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_folder(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_folder(TEXT) TO authenticated;
