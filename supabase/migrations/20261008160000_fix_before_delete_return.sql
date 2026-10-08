-- Fix: prevent_super_admin_tampering() returned NULL for all DELETE
-- operations, which in PostgreSQL BEFORE triggers means "skip the
-- operation". That blocked every delete from public.profiles, including
-- the cascade from auth.users, so hard-deleting a user left an orphaned
-- profile row.
--
-- The correct return for a BEFORE DELETE trigger that wants to allow the
-- delete is OLD. NULL means cancel.
--
-- After this fix:
--   * DELETE FROM auth.users cascades to public.profiles (and auth.identities)
--   * Direct DELETE FROM public.profiles for a non-super_admin row succeeds
--   * DELETE of a super_admin row still raises P0002
CREATE OR REPLACE FUNCTION public.prevent_super_admin_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    -- Block DELETE of a super_admin
    IF TG_OP = 'DELETE' AND OLD.role = 'super_admin' THEN
        RAISE EXCEPTION 'Cannot delete a Super Admin'
            USING ERRCODE = 'P0002';
    END IF;

    -- Block direct UPDATE of role/status on a super_admin row
    -- Allow role change if authorized by admin_set_user_role RPC (via session variable)
    IF TG_OP = 'UPDATE' AND OLD.role = 'super_admin' THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            IF current_setting('admin.allow_super_admin_role_change', true) <> 'true' THEN
                RAISE EXCEPTION 'Super Admin role can only be changed via admin_set_user_role()'
                    USING ERRCODE = 'P0003';
            END IF;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Super Admin status cannot be changed'
                USING ERRCODE = 'P0004';
        END IF;
    END IF;

    -- For DELETE of a non-super_admin, allow the operation by returning OLD.
    -- Returning NULL here would cancel the delete (that was the old bug).
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_super_admin_rows ON public.profiles;
CREATE TRIGGER protect_super_admin_rows
    BEFORE UPDATE OF role, status OR DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_super_admin_tampering();

REVOKE ALL ON FUNCTION public.prevent_super_admin_tampering() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_super_admin_tampering() TO authenticated;