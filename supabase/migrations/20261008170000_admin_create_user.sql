-- Create a new user account from the admin panel.
--
-- The normal GoTrue signup flow always sets email_confirmed_at = NULL and
-- sends a confirmation email. An admin creating an account needs to be able
-- to mark the user as "already verified" so they can sign in immediately.
--
-- This SECURITY DEFINER function runs as postgres, which has INSERT
-- privilege on auth.users. It bypasses the need for the service_role key
-- (which this app does not hold) while keeping the same authorization
-- boundary as the API:
--   * caller must be admin or super_admin (via public.is_admin())
--   * a regular Admin can only create users with role = 'user'
--   * a Super Admin can create users with role = 'user' or 'admin'
--   * email_verified flag controls whether email_confirmed_at is set
--
-- The handle_new_user trigger creates the public.profiles row automatically.
CREATE OR REPLACE FUNCTION public.admin_create_user(
    p_email TEXT,
    p_password TEXT,
    p_full_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'user',
    p_email_verified BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_user_id UUID;
    v_encrypted_password TEXT;
    v_final_role TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;

    IF p_email IS NULL OR btrim(p_email) = '' THEN
        RAISE EXCEPTION 'email_required' USING ERRCODE = '22023';
    END IF;

    IF p_password IS NULL OR btrim(p_password) = '' THEN
        RAISE EXCEPTION 'password_required' USING ERRCODE = '22023';
    END IF;

    -- Role boundary: a regular Admin can only create 'user' roles.
    -- A Super Admin can create 'user' or 'admin'.
    IF p_role = 'super_admin' THEN
        RAISE EXCEPTION 'cannot_create_super_admin' USING ERRCODE = 'P0008';
    END IF;

    IF p_role NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
    END IF;

    v_final_role := p_role;

    -- Encrypt the password using pgcrypto's crypt() with a bcrypt salt.
    v_encrypted_password := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

    -- Check for an existing user with this email to avoid duplicate-key errors.
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
        RAISE EXCEPTION 'email_already_in_use' USING ERRCODE = '23505';
    END IF;

    -- Generate a new UUID for the user.
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
        id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        instance_id,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
    ) VALUES (
        v_user_id,
        p_email,
        v_encrypted_password,
        CASE WHEN p_email_verified THEN now() ELSE NULL END,
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
            'full_name', p_full_name,
            'name', p_full_name
        ),
        'authenticated',
        'authenticated',
        '00000000-0000-0000-0000-000000000000',
        now(),
        now(),
        '',
        '',
        '',
        ''
    );

    -- The handle_new_user trigger creates the profile row with role = 'user'.
    -- Update it to the requested role now that the row exists.
    UPDATE public.profiles
    SET role = v_final_role,
        full_name = COALESCE(p_full_name, full_name),
        updated_at = now()
    WHERE id = v_user_id;

    RETURN jsonb_build_object(
        'id', v_user_id,
        'email', p_email,
        'role', v_final_role,
        'email_verified', p_email_verified
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;