-- ==========================================================
-- Admin write paths for coupons and user groups
--
-- These re-check is_admin() server-side. They exist instead of plain
-- RLS because two of the rules are cross-row and a CHECK constraint
-- cannot see other rows:
--
--   - a percentage coupon must not exceed 100
--   - applies_to='products' must have at least one product attached,
--     otherwise the coupon can never match a cart and is dead config
--   - a flat coupon must be worth something against a real cart
-- ==========================================================

-- ------------------------------------------------------------
-- admin_save_coupon()
--
-- payload:
--   { id?, code, description?, group_id?, applies_to?, discount_type?,
--     discount_value, minimum_order_value?, max_uses?, max_uses_per_user?,
--     starts_at, ends_at, status?, product_ids? }
--
-- coupon_products is only touched when product_ids is present, so a
-- partial update cannot silently detach every product. Same contract
-- as admin_save_promotion().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_coupon(payload jsonb)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id        TEXT := NULLIF(payload->>'id', '');
    v_code      TEXT := upper(btrim(COALESCE(payload->>'code', '')));
    v_group     TEXT := NULLIF(btrim(COALESCE(payload->>'group_id', '')), '');
    v_applies   TEXT := COALESCE(NULLIF(payload->>'applies_to', ''), 'order');
    v_dtype     TEXT := COALESCE(NULLIF(payload->>'discount_type', ''), 'percentage');
    v_value     NUMERIC := COALESCE(NULLIF(payload->>'discount_value', '')::NUMERIC, 0);
    v_min_order NUMERIC := COALESCE(NULLIF(payload->>'minimum_order_value', '')::NUMERIC, 0);
    v_max_uses  INTEGER := NULLIF(payload->>'max_uses', '')::INTEGER;
    v_per_user  INTEGER := COALESCE(NULLIF(payload->>'max_uses_per_user', '')::INTEGER, 1);
    v_starts_at TIMESTAMPTZ := NULLIF(payload->>'starts_at', '')::TIMESTAMPTZ;
    v_ends_at   TIMESTAMPTZ := NULLIF(payload->>'ends_at', '')::TIMESTAMPTZ;
    v_status    TEXT := COALESCE(NULLIF(payload->>'status', ''), 'draft');
    v_products  TEXT[];
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_code = '' THEN
        RAISE EXCEPTION 'code_required' USING ERRCODE = '22023';
    END IF;
    -- Mirrors coupons_code_format so the error is a readable 422
    -- rather than a raw constraint violation.
    IF v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' THEN
        RAISE EXCEPTION 'invalid_coupon_code' USING ERRCODE = '22023';
    END IF;
    IF v_starts_at IS NULL OR v_ends_at IS NULL THEN
        RAISE EXCEPTION 'timeframe_required' USING ERRCODE = '22023';
    END IF;
    IF v_ends_at <= v_starts_at THEN
        RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023';
    END IF;
    IF v_dtype = 'percentage' AND v_value > 100 THEN
        RAISE EXCEPTION 'invalid_discount_value' USING ERRCODE = '22023';
    END IF;
    IF v_value < 0 OR v_min_order < 0 THEN
        RAISE EXCEPTION 'invalid_discount_value' USING ERRCODE = '22023';
    END IF;
    IF v_applies NOT IN ('order', 'products') THEN
        RAISE EXCEPTION 'invalid_applies_to' USING ERRCODE = '22023';
    END IF;
    IF v_status NOT IN ('draft', 'active', 'cancelled') THEN
        RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
    END IF;
    IF v_max_uses IS NOT NULL AND v_max_uses < 1 THEN
        RAISE EXCEPTION 'invalid_max_uses' USING ERRCODE = '22023';
    END IF;
    IF v_per_user < 1 THEN
        RAISE EXCEPTION 'invalid_max_uses' USING ERRCODE = '22023';
    END IF;

    IF v_group IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_groups g WHERE g.id = v_group
    ) THEN
        RAISE EXCEPTION 'group_not_found' USING ERRCODE = '22023';
    END IF;

    -- Read the target row's product set when validating scope, so
    -- editing one field of an existing product-scoped coupon does not
    -- demand the product list be resent.
    IF payload ? 'product_ids' THEN
        SELECT COALESCE(array_agg(DISTINCT t.pid), ARRAY[]::TEXT[])
        INTO v_products
        FROM jsonb_array_elements_text(
                 COALESCE(payload->'product_ids', '[]'::JSONB)) AS t(pid)
        WHERE NULLIF(btrim(t.pid), '') IS NOT NULL;
    ELSE
        SELECT COALESCE(array_agg(cp.product_id), ARRAY[]::TEXT[])
        INTO v_products
        FROM public.coupon_products cp
        WHERE cp.coupon_id = v_id;
    END IF;

    IF v_applies = 'products' AND COALESCE(array_length(v_products, 1), 0) = 0 THEN
        RAISE EXCEPTION 'products_required' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.coupons c WHERE upper(c.code) = v_code) THEN
            RAISE EXCEPTION 'duplicate_coupon_code' USING ERRCODE = '23505';
        END IF;

        INSERT INTO public.coupons (
            id, code, description, group_id, applies_to, discount_type,
            discount_value, minimum_order_value, max_uses, max_uses_per_user,
            starts_at, ends_at, status
        ) VALUES (
            COALESCE(NULLIF(payload->>'new_id', ''), gen_random_uuid()::TEXT),
            v_code,
            NULLIF(btrim(COALESCE(payload->>'description', '')), ''),
            v_group,
            v_applies,
            v_dtype,
            v_value,
            v_min_order,
            v_max_uses,
            v_per_user,
            v_starts_at,
            v_ends_at,
            v_status
        ) RETURNING id INTO v_id;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.coupons
            WHERE upper(code) = v_code AND id <> v_id
        ) THEN
            RAISE EXCEPTION 'duplicate_coupon_code' USING ERRCODE = '23505';
        END IF;

        UPDATE public.coupons
        SET code                = v_code,
            description         = NULLIF(btrim(COALESCE(payload->>'description', '')), ''),
            group_id            = v_group,
            applies_to          = v_applies,
            discount_type       = v_dtype,
            discount_value      = v_value,
            minimum_order_value = v_min_order,
            max_uses            = v_max_uses,
            max_uses_per_user   = v_per_user,
            starts_at           = v_starts_at,
            ends_at             = v_ends_at,
            status              = v_status,
            updated_at          = now()
        WHERE id = v_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'coupon_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF payload ? 'product_ids' THEN
        DELETE FROM public.coupon_products WHERE coupon_id = v_id;
        INSERT INTO public.coupon_products (coupon_id, product_id)
        SELECT v_id, p.pid
        FROM unnest(v_products) AS p(pid)
        WHERE EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = p.pid)
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_coupon(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_coupon(jsonb) TO authenticated;

-- ------------------------------------------------------------
-- admin_save_user_group()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_save_user_group(payload jsonb)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id     TEXT := NULLIF(payload->>'id', '');
    v_name   TEXT := NULLIF(btrim(COALESCE(payload->>'name', '')), '');
    v_slug   TEXT := NULLIF(btrim(COALESCE(payload->>'slug', '')), '');
    v_active BOOLEAN := COALESCE((payload->>'is_active')::BOOLEAN, TRUE);
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'name_required' USING ERRCODE = '22023';
    END IF;

    -- Slug is the stable key used in URLs and imports; derive it from
    -- the name when the caller did not send one.
    IF v_slug IS NULL THEN
        v_slug := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '-', 'g'));
        v_slug := trim(both '-' FROM v_slug);
    END IF;

    IF v_slug = '' THEN
        RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
    END IF;

    IF v_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.user_groups g WHERE lower(g.slug) = lower(v_slug)) THEN
            RAISE EXCEPTION 'duplicate_group_slug' USING ERRCODE = '23505';
        END IF;

        INSERT INTO public.user_groups (name, slug, description, is_active)
        VALUES (v_name, v_slug, NULLIF(btrim(COALESCE(payload->>'description', '')), ''), v_active)
        RETURNING id INTO v_id;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.user_groups
            WHERE lower(slug) = lower(v_slug) AND id <> v_id
        ) THEN
            RAISE EXCEPTION 'duplicate_group_slug' USING ERRCODE = '23505';
        END IF;

        UPDATE public.user_groups
        SET name        = v_name,
            slug        = v_slug,
            description = NULLIF(btrim(COALESCE(payload->>'description', '')), ''),
            is_active   = v_active,
            updated_at  = now()
        WHERE id = v_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_user_group(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_user_group(jsonb) TO authenticated;

-- ------------------------------------------------------------
-- admin_set_group_members()
--
-- Replaces the membership of a group. Accepts emails and/or profile
-- ids, because an admin is far more likely to have an email from a
-- customer than a UUID.
--
-- payload: { group_id, emails?: string[], user_ids?: string[] }
--
-- An explicitly present but empty array clears the group, which is
-- how the admin UI removes the last member. A MISSING key is a no-op,
-- so a partial update cannot wipe membership by accident.
--
-- Returns the resolved member list plus any emails that matched no
-- account, so the UI can tell the admin which invites failed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_group_members(payload jsonb)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_group     TEXT := NULLIF(btrim(COALESCE(payload->>'group_id', '')), '');
    v_emails    TEXT[];
    v_user_ids  TEXT[];
    v_resolved  UUID[];
    v_unmatched TEXT[] := ARRAY[]::TEXT[];
    v_email     TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;

    IF v_group IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_groups g WHERE g.id = v_group
    ) THEN
        RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (payload ? 'emails' OR payload ? 'user_ids') THEN
        RAISE EXCEPTION 'no_members_supplied' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(array_agg(lower(btrim(t.v))), ARRAY[]::TEXT[])
    INTO v_emails
    FROM jsonb_array_elements_text(
             COALESCE(payload->'emails', '[]'::JSONB)) AS t(v)
    WHERE NULLIF(btrim(t.v), '') IS NOT NULL;

    SELECT COALESCE(array_agg(btrim(t.v)), ARRAY[]::TEXT[])
    INTO v_user_ids
    FROM jsonb_array_elements_text(
             COALESCE(payload->'user_ids', '[]'::JSONB)) AS t(v)
    WHERE NULLIF(btrim(t.v), '') IS NOT NULL;

    -- Prefer profiles.email, fall back to auth.users for anyone whose
    -- profile has not caught up with a recent signup.
    v_unmatched := v_unmatched
        || ARRAY(
            SELECT u FROM unnest(v_user_ids) AS u
            WHERE u !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        );

    FOR v_email IN SELECT unnest(v_emails) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE lower(p.email) = v_email
            UNION ALL
            SELECT 1 FROM auth.users u
            WHERE lower(u.email) = v_email
        ) THEN
            v_unmatched := array_append(v_unmatched, v_email);
        END IF;
    END LOOP;

    SELECT COALESCE(array_agg(DISTINCT x.uid), ARRAY[]::UUID[])
    INTO v_resolved
    FROM (
        SELECT p.id AS uid
        FROM public.profiles p
        WHERE lower(p.email) = ANY(v_emails)
        UNION
        SELECT u.id
        FROM auth.users u
        WHERE lower(u.email) = ANY(v_emails)
        UNION
        -- Only well-formed uuids join the set; a malformed one is
        -- reported as unmatched instead of aborting the whole call.
        SELECT u::UUID
        FROM unnest(v_user_ids) AS u
        WHERE u ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) x;

    DELETE FROM public.user_group_members WHERE group_id = v_group;

    INSERT INTO public.user_group_members (group_id, user_id)
    SELECT v_group, r
    FROM unnest(v_resolved) AS r
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object(
        'group_id', v_group,
        'member_count', COALESCE(array_length(v_resolved, 1), 0),
        'unmatched_emails', to_jsonb(v_unmatched)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_group_members(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_group_members(jsonb) TO authenticated;
