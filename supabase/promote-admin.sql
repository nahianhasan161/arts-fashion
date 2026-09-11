-- ==========================================================
-- PROMOTE A USER TO ADMIN BY EMAIL
-- ==========================================================
-- Usage: Replace 'your-email@example.com' with the target user's email
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- ==========================================================

-- Step 1: Find the user by email and update their role
UPDATE public.profiles
SET role = 'admin', updated_at = now()
WHERE id = (
    SELECT id FROM auth.users WHERE email = 'nahianhasan161@gmail.com'
);

-- Step 2: Verify the change
SELECT p.id, u.email, p.full_name, p.role, p.updated_at
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email = 'nahianhasan161@gmail.com';

-- ==========================================================
-- DEMOTE AN ADMIN BACK TO USER (if needed)
-- ==========================================================
-- UPDATE public.profiles
-- SET role = 'user', updated_at = now()
-- WHERE id = (
--     SELECT id FROM auth.users WHERE email = 'your-email@example.com'
-- );
