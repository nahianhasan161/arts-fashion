-- Test function to debug super_admin count
CREATE OR REPLACE FUNCTION public.test_super_admin_count()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count
    FROM public.profiles
    WHERE role = 'super_admin';
    
    RAISE NOTICE 'DEBUG test_super_admin_count: %', v_count;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.test_super_admin_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.test_super_admin_count() TO authenticated;