-- Keep profiles.email in step with auth.users.email, and stop the user list
-- needing a service-role key to display an address.
--
-- The failure this fixes
-- ----------------------
-- GET /api/admin/users ended with:
--
--     const { data: authUsers, error: usersError } =
--       await supabase.auth.admin.listUsers();
--
-- The admin gate had already passed by that point -- the caller had a valid
-- session and an admin profile -- so the request was authenticated and
-- authorized, and it still failed, every time, with:
--
--     HTTP 500 {"error":"This endpoint requires a valid Bearer token"}
--
-- Because `auth.admin.*` is the GoTrue ADMIN API, it rejects any client that is
-- not holding the service_role key. A server client built from the publishable
-- key, even one with a perfectly good user session, is not that. The error is
-- about the KEY the endpoint is calling with, not about the CALLER's identity,
-- which is why the message is actively misleading: it names the symptom the
-- caller was already trying to rule out.
--
-- Adding an Authorization header to the browser's fetch does not help, and
-- cannot: the admin API wants a service_role Bearer token, and a user's own
-- access token is exactly the wrong credential. The two are not degrees of the
-- same thing.
--
-- Why not just add a service_role key
-- ---------------------------------
-- Because it is not needed. The endpoint wanted auth.users only to recover an
-- email address, and profiles already HAS an email column. The column was
-- simply never populated: handle_new_user() inserted (id, full_name,
-- avatar_url, role) and omitted it, so every user who signed up through the real
-- signup path had profiles.email = NULL. The three profiles that looked correct
-- were created by the test suites, which insert the column explicitly.
--
-- So the fix is the email sync below, and the endpoint stops asking auth for
-- something it should already have. That also removes the last privileged
-- credential from the application's runtime, and fixes a latent bug: the old
-- listUsers() call was unpaginated, so past the first 50 users the addresses
-- came back null anyway while still paying for the call.

-- ---------------------------------------------------------------- the trigger

-- email included, so a signed-up user has an address on their profile.
--
-- The ON CONFLICT clause updates email only, and never role. A signup trigger
-- that could also write role would be able to hand out admin, so role is
-- excluded from the conflict action by construction: there is no code path in
-- this function that can set it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
        COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', NEW.raw_user_meta_data ->> 'picture'),
        NEW.email,
        'user'
    )
    ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            updated_at = now()
        WHERE public.profiles.email IS DISTINCT FROM EXCLUDED.email;
    RETURN NEW;
END;
$$;

-- auth.users is the source of truth for the address; this is a copy of it, and
-- a copy goes stale. A user who changes their email -- the confirmation flow
-- updates auth.users before the profile ever learns about it -- would otherwise
-- keep the old address on their profile, and the admin user list would show an
-- address that no longer reaches them.
--
-- AFTER UPDATE OF email only, so an unrelated profile change does not fire it.
CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
    UPDATE public.profiles
       SET email = NEW.email,
           updated_at = now()
     WHERE id = NEW.id
       AND email IS DISTINCT FROM NEW.email;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_user_email_change();

-- ---------------------------------------------------------------- the backfill

-- The rows the trigger missed: everyone who signed up while it was not writing
-- email. LEFT JOINed rather than matched on a pattern, so this repairs whatever
-- is actually stale instead of the cases that happened to be thought of.
--
-- rows_updated is reported by the applier; a count of 0 here means the trigger
-- had been keeping up, which is a useful thing to see rather than a silent
-- no-op.
UPDATE public.profiles p
   SET email = u.email,
       updated_at = now()
  FROM auth.users u
 WHERE u.id = p.id
   AND p.email IS DISTINCT FROM u.email;
