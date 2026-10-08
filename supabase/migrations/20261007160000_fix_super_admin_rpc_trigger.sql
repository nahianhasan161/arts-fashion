-- Fix: Allow admin_set_user_role RPC to update super_admin role
-- The BEFORE trigger prevent_super_admin_tampering blocks all role changes on super_admin rows,
-- including the legitimate RPC call. Use a session variable to authorize the RPC's update.

-- Update the trigger to allow role changes when authorized via session variable
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

    RETURN NEW;
END;
$$;

-- Update the RPC function to set the session variable before updating
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id UUID, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_target_role TEXT;
    v_super_count INTEGER;
BEGIN
    -- 1. Caller must be super_admin
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'super_admin_required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Validate role
    IF p_role NOT IN ('user', 'admin', 'super_admin') THEN
        RAISE EXCEPTION 'invalid_role'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Fetch target's current role
    SELECT role INTO v_target_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;

    -- 4. Prevent self-demotion from super_admin
    IF v_target_role = 'super_admin' AND p_user_id = auth.uid() AND p_role <> 'super_admin' THEN
        RAISE EXCEPTION 'self_demotion_forbidden'
            USING ERRCODE = 'P0006';
    END IF;

    -- 5. Prevent demoting the LAST super_admin
    IF v_target_role = 'super_admin' AND p_role <> 'super_admin' THEN
        SELECT count(*) INTO v_super_count
        FROM public.profiles
        WHERE role = 'super_admin';

        IF v_super_count <= 1 THEN
            RAISE EXCEPTION 'last_super_admin_cannot_be_demoted'
                USING ERRCODE = 'P0007';
        END IF;
    END IF;

    -- 6. Apply the change. Authorize the role change via session variable.
    -- The BEFORE trigger checks this variable to allow the update.
    PERFORM set_config('admin.allow_super_admin_role_change', 'true', false);
    UPDATE public.profiles
    SET role = p_role,
        updated_at = now()
    WHERE id = p_user_id;
    PERFORM set_config('admin.allow_super_admin_role_change', 'false', false);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;

-- Recreate the trigger with the updated function
DROP TRIGGER IF EXISTS protect_super_admin_rows ON public.profiles;
CREATE TRIGGER protect_super_admin_rows
    BEFORE UPDATE OF role, status OR DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_super_admin_tampering();

REVOKE ALL ON FUNCTION public.prevent_super_admin_tampering() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_super_admin_tampering() TO authenticated;