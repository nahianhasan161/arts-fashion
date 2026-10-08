-- Clean up all test users with trigger disabled
ALTER TABLE public.profiles DISABLE TRIGGER protect_super_admin_rows;
DELETE FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';
ALTER TABLE public.profiles ENABLE TRIGGER protect_super_admin_rows;

SELECT count(*) FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';