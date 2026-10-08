-- Test DELETE with immediate SELECT
DELETE FROM public.profiles WHERE email = 'au-bystander-1791355824821@example.test';
SELECT count(*) FROM public.profiles WHERE email = 'au-bystander-1791355824821@example.test';