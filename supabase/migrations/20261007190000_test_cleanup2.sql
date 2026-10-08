-- Test cleanup with DO block
DO $$
BEGIN
  PERFORM set_config('admin.allow_super_admin_role_change', 'true', false);
  DELETE FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';
  PERFORM set_config('admin.allow_super_admin_role_change', 'false', false);
END $$;

SELECT count(*) FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';