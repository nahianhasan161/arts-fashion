-- Test DELETE with fixed trigger
-- Create test user
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (gen_random_uuid(), 'test-delete@example.test', extensions.crypt('test123', extensions.gen_salt('bf',10)),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated','authenticated','00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', '')
    RETURNING id INTO v_user_id;

    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_user_id, v_user_id,
      jsonb_build_object('sub', v_user_id, 'email', 'test-delete@example.test', 'email_verified', true),
      'email', now(), now(), now());

    INSERT INTO public.profiles (id, email, role) VALUES (v_user_id, 'test-delete@example.test', 'admin');
END $$;

-- Try to delete
DELETE FROM public.profiles WHERE email = 'test-delete@example.test';
SELECT count(*) FROM public.profiles WHERE email = 'test-delete@example.test';