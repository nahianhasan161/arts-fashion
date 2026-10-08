-- Update is_admin() to also return true for super_admin
-- This ensures the RLS policy "Admins can view all profiles" applies to super_admins too

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_claim TEXT;
BEGIN
    -- The missing_ok form returns NULL when no JWT is present at all, so an
    -- anonymous request is refused rather than raising.
    v_claim := current_setting('request.jwt.claims', true);

    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = NULLIF(v_claim::JSONB ->> 'sub', '')::UUID
          AND role IN ('admin', 'super_admin')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;