-- Fix trigger to explicitly return NULL for DELETE
CREATE OR REPLACE FUNCTION public.prevent_super_admin_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
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
            -- Check if this update is authorized by the RPC function
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

    -- For DELETE, return NULL to allow the operation
    IF TG_OP = 'DELETE' THEN
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_super_admin_tampering() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_super_admin_tampering() TO authenticated;