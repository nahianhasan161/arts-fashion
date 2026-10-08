-- Test function to mimic RPC logic
CREATE OR REPLACE FUNCTION public.test_rpc_logic(p_user_id UUID, p_role TEXT)
RETURNS TABLE(v_super_count INTEGER, v_target_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_target_role_local TEXT;
    v_super_count_local INTEGER;
BEGIN
    -- 3. Fetch target's current role
    SELECT role INTO v_target_role_local
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_target_role_local IS NULL THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;

    -- 5. Prevent demoting the LAST super_admin
    IF v_target_role_local = 'super_admin' AND p_role <> 'super_admin' THEN
        SELECT count(*) INTO v_super_count_local
        FROM public.profiles
        WHERE role = 'super_admin';

        RAISE NOTICE 'DEBUG test_rpc_logic: v_super_count = %', v_super_count_local;
    END IF;

    RETURN QUERY SELECT v_super_count_local, v_target_role_local;
END;
$$;

REVOKE ALL ON FUNCTION public.test_rpc_logic(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_rpc_logic(UUID, TEXT) TO authenticated;