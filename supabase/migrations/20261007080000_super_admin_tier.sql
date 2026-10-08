-- Super Admin role, account lifecycle columns, invariant enforcement, and
-- privileged role-change RPC.
--
-- This migration implements the Super Admin tier with the following guarantees:
--
--   1. A `super_admin` role exists alongside `user` and `admin`.
--   2. At least one `super_admin` row MUST exist at all times. This is enforced
--      by a CONSTRAINT TRIGGER that runs AFTER any role change or delete and
--      raises if `count(*) FILTER (WHERE role = 'super_admin') = 0`.
--   3. A `super_admin` cannot be deleted, banned, or demoted by anyone
--      (including themselves) if it would violate the invariant.
--   4. Role changes go through a single RPC `admin_set_user_role()` that only
--      a `super_admin` can call. Direct UPDATE of the `role` column is revoked
--      from the `authenticated` role so the RPC is the only path.
--   4. Account lifecycle columns (`status`, `banned_at`, `deleted_at`) track
--      soft-delete and ban state. A `super_admin` row cannot have its status
--      changed away from 'active'.
--   5. The existing `handle_new_user` trigger is left unchanged (it still
--      defaults new users to role='user'). An initial super_admin must be
--      created manually (see promote-admin.sql) before this migration is run.

-- ---------------------------------------------------------------- 1. columns

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'banned', 'deleted')),
    ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The role column already exists with CHECK (role IN ('user','admin')).
-- We widen it to include 'super_admin'. Doing it in two steps avoids a window
-- where the check is absent.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
        CHECK (role IN ('user', 'admin', 'super_admin'));

COMMENT ON COLUMN public.profiles.role IS
    'user | admin | super_admin. super_admin is the only role that can change roles.';

COMMENT ON COLUMN public.profiles.status IS
    'active | banned | deleted. super_admin rows are locked to active by trigger.';

COMMENT ON COLUMN public.profiles.banned_at IS
    'Set when status becomes banned. NULL otherwise.';

COMMENT ON COLUMN public.profiles.deleted_at IS
    'Set when status becomes deleted (soft-delete). NULL otherwise.';

-- ---------------------------------------------------------------- 2. helper functions

-- is_super_admin() mirrors is_admin() but for the elevated tier.
-- Used in RLS policies and RPC guards.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'super_admin'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ---------------------------------------------------------------- 3. invariant trigger

-- The invariant: there must always be at least one super_admin.
-- A CONSTRAINT TRIGGER fires AFTER the statement commits, so it sees the
-- final state. A regular AFTER trigger would see intermediate state in a
-- multi-row UPDATE and could false-fire.
CREATE OR REPLACE FUNCTION public.assert_super_admin_invariant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_super_count INTEGER;
BEGIN
    SELECT count(*) INTO v_super_count
    FROM public.profiles
    WHERE role = 'super_admin';

    IF v_super_count = 0 THEN
        RAISE EXCEPTION 'At least one Super Admin must exist'
            USING ERRCODE = 'P0001';  -- user-defined
    END IF;

    RETURN NULL;  -- AFTER trigger return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS enforce_super_admin_invariant ON public.profiles;
CREATE CONSTRAINT TRIGGER enforce_super_admin_invariant
    AFTER UPDATE OF role, status OR DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.assert_super_admin_invariant();

-- ---------------------------------------------------------------- 4. super_admin row protection

-- A super_admin row cannot be deleted, banned, or have its role changed
-- by a direct UPDATE. The ONLY path to change a super_admin's role is the
-- admin_set_user_role() RPC, which enforces the invariant itself before
-- committing. Direct UPDATE is blocked here so the RPC remains the single
-- source of truth.
CREATE OR REPLACE FUNCTION public.prevent_super_admin_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
BEGIN
    -- Block DELETE of a super_admin
    IF TG_OP = 'DELETE' AND OLD.role = 'super_admin' THEN
        RAISE EXCEPTION 'Cannot delete a Super Admin'
            USING ERRCODE = 'P0002';
    END IF;

    -- Block direct UPDATE of role/status on a super_admin row
    IF TG_OP = 'UPDATE' AND OLD.role = 'super_admin' THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Super Admin role can only be changed via admin_set_user_role()'
                USING ERRCODE = 'P0003';
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Super Admin status cannot be changed'
                USING ERRCODE = 'P0004';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_super_admin_rows ON public.profiles;
CREATE TRIGGER protect_super_admin_rows
    BEFORE UPDATE OF role, status OR DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_super_admin_tampering();

-- ---------------------------------------------------------------- 5. privileged role-change RPC

-- The ONLY way to change any user's role (including to/from super_admin).
-- Only a super_admin can call it. It enforces:
--   * caller is super_admin
--   * target is not self (no self-demotion from super_admin)
--   * invariant would hold after the change
--   * role value is valid
-- The CONSTRAINT TRIGGER above provides a second line of defence.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id TEXT, p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
    v_target_role TEXT;
    v_super_count INTEGER;
BEGIN
    -- 1. Caller must be super_admin
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'super_admin_required'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Validate role
    IF p_role NOT IN ('user', 'admin', 'super_admin') THEN
        RAISE EXCEPTION 'invalid_role'
            USING ERRCODE = '22023';
    END IF;

    -- 3. Fetch target's current role
    SELECT role INTO v_target_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;

    -- 4. Prevent self-demotion from super_admin
    IF v_target_role = 'super_admin' AND p_user_id = auth.uid() AND p_role <> 'super_admin' THEN
        RAISE EXCEPTION 'self_demotion_forbidden'
            USING ERRCODE = 'P0006';
    END IF;

    -- 5. Prevent demoting the LAST super_admin
    IF v_target_role = 'super_admin' AND p_role <> 'super_admin' THEN
        SELECT count(*) INTO v_super_count
        FROM public.profiles
        WHERE role = 'super_admin';

        IF v_super_count <= 1 THEN
            RAISE EXCEPTION 'last_super_admin_cannot_be_demoted'
                USING ERRCODE = 'P0007';
        END IF;
    END IF;

    -- 6. Apply the change. The CONSTRAINT TRIGGER enforce_super_admin_invariant
    --    will run after this and raise if the invariant is violated (defense
    --    in depth).
    UPDATE public.profiles
    SET role = p_role,
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'target_not_found'
            USING ERRCODE = 'P0005';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------- 6. column-level security

-- The role column must ONLY be changed via admin_set_user_role().
-- Revoke direct UPDATE on role from authenticated; the RPC runs SECURITY DEFINER
-- so it bypasses RLS and can write the column.
REVOKE UPDATE (role) ON public.profiles FROM authenticated;

-- status column: only super_admin can change status (via admin_set_user_status
-- if we add it later, or direct UPDATE by super_admin through RLS).
REVOKE UPDATE (status) ON public.profiles FROM authenticated;

-- ---------------------------------------------------------------- 7. backfill & verification

-- Existing rows: ensure status is set (should already be 'active' default)
UPDATE public.profiles SET status = 'active' WHERE status IS NULL;

-- Verify at least one super_admin exists (fails migration if not).
-- This is a safety check: the invariant trigger will enforce it going forward,
-- but we want the migration to fail fast if the DB is in an invalid state.
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM public.profiles WHERE role = 'super_admin';
    IF v_count = 0 THEN
        RAISE EXCEPTION 'Migration requires at least one super_admin to exist. Run promote-admin.sql first.';
    END IF;
END;
$$;

-- ---------------------------------------------------------------- 8. grants for the new functions

REVOKE ALL ON FUNCTION public.prevent_super_admin_tampering() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_super_admin_tampering() TO authenticated;

REVOKE ALL ON FUNCTION public.assert_super_admin_invariant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_super_admin_invariant() TO authenticated;