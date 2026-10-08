-- Test cleanup script
DO $$
BEGIN
  PERFORM set_config('admin.allow_super_admin_role_change', 'true', false);
  UPDATE public.profiles SET role = 'admin' WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';
  PERFORM set_config('admin.allow_super_admin_role_change', 'false', false);
END $$;

DELETE FROM auth.users WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';

SELECT count(*) FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';