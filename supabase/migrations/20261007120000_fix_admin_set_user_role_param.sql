-- Fix admin_set_user_role parameter type from TEXT to UUID
-- The profiles.id column is UUID, so the parameter should be UUID to avoid
-- "operator does not exist: uuid = text" errors.

-- Drop the old TEXT version first to avoid overload ambiguity
DROP FUNCTION IF EXISTS public.admin_set_user_role(TEXT, TEXT);

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

    -- 6. Apply the change. The CONSTRAINT TRIGGER enforce_super_admin_invariant
    --    will run after this and raise if the invariant is violated (defense
    --    in depth).
    UPDATE public.profiles
    SET role = p_role,
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(UUID, TEXT) TO authenticated;