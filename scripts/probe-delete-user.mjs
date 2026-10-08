/**
 * Probe: can a SECURITY DEFINER function (owned by postgres)
 * hard-delete from auth.users? The GoTrue admin API needs the
 * service_role key, which the app runtime does not hold. If a
 * SECURITY DEFINER function can delete from auth.users directly,
 * we can hard-delete via RPC without that key.
 *
 * We cannot sign in as the real super_admin (no password), so we
 * create a throwaway super_admin by promoting a fresh user through
 * the Management API (which runs as a privileged role, so the
 * REVOKE UPDATE(role) ... FROM authenticated does not apply).
 *
 * Steps:
 *   1. create a throwaway super_admin (auth user + profile, then
 *      promote via SQL)
 *   2. create a throwaway victim (role=user)
 *   3. create admin_delete_user() SECURITY DEFINER
 *   4. sign in as the throwaway super_admin
 *   5. call the RPC with the victim's id
 *   6. assert the victim is gone from auth.users AND profiles
 *
 * Everything is removed in finally.
 */
const ref = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const token = process.env.SUPABASE_ACCESS_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
import { createServerClient } from "@supabase/ssr";

const PWD = "DeleteProbe12345!";
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

async function sql(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }
  );
  const text = await r.text();
  if (r.status >= 400) throw new Error(`SQL failed: ${text.slice(0, 400)}\n${query.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function col1(query) {
  return (await sql(query))[0];
}

async function mkUser(tag, role) {
  const id = (await col1("SELECT gen_random_uuid() AS id")).id;
  const email = `delprobe-${tag}-${Date.now()}@example.test`;
  await sql(`
    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
      raw_user_meta_data, aud, role, instance_id, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      ${q(id)}, ${q(email)}, extensions.crypt(${q(PWD)}, extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', ''
    )
  `);
  await sql(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${q(id)}, ${q(id)},
      ${q(JSON.stringify({ sub: id, email, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  // handle_new_user() already inserted the profile; upsert to set
  // email and (for the admin) the role we want.
  await sql(
    `INSERT INTO public.profiles (id, email, role) VALUES (${q(id)}, ${q(email)}, ${q(role)})
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`
  );
  return { id, email };
}

async function signIn(email) {
  const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PWD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("sign-in failed: " + JSON.stringify(j).slice(0, 300));

  const jar = {};
  const client = createServerClient(supabaseUrl, publishable, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar[name] = value;
      },
    },
  });
  const { error } = await client.auth.setSession({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
  });
  if (error) throw new Error("setSession failed: " + error.message);

  const cookies = Object.entries(jar).map(([name, value]) => `${name}=${value}`);
  return { cookie: cookies.join("; "), accessToken: j.access_token };
}

let admin = null;
let victim = null;

try {
  // 1. throwaway super_admin + victim
  admin = await mkUser("admin", "super_admin");
  victim = await mkUser("victim", "user");
  console.log("created test super_admin:", admin.email);
  console.log("created victim:", victim.email);

  // 2. create the SECURITY DEFINER function
  await sql(`
    CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id TEXT)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
    DECLARE
        v_target_role TEXT;
    BEGIN
        IF NOT public.is_admin() THEN
            RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
        END IF;

        IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
            RAISE EXCEPTION 'user_id_required' USING ERRCODE = '22023';
        END IF;

        SELECT role INTO v_target_role
        FROM public.profiles
        WHERE id = p_user_id::uuid;

        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0005';
        END IF;

        IF v_target_role = 'super_admin' THEN
            RAISE EXCEPTION 'cannot_delete_super_admin' USING ERRCODE = 'P0002';
        END IF;

        DELETE FROM auth.users WHERE id = p_user_id::uuid;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0005';
        END IF;

        RETURN jsonb_build_object('id', p_user_id);
    END;
    $$;

    REVOKE ALL ON FUNCTION public.admin_delete_user(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.admin_delete_user(TEXT) TO authenticated;
  `);
  console.log("created admin_delete_user() function");

  // 3. sign in as the throwaway super_admin
  const as = await signIn(admin.email);
  console.log("signed in as test super_admin");

  // 4. call the RPC
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/admin_delete_user`, {
    method: "POST",
    headers: {
      apikey: publishable,
      Authorization: `Bearer ${as.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ p_user_id: victim.id }),
  });
  const body = await r.json().catch(() => ({}));
  console.log("RPC status:", r.status, "body:", JSON.stringify(body));

  // 5. verify deletion
  const inAuth = await col1(`SELECT count(*)::int c FROM auth.users WHERE id = ${q(victim.id)}`);
  const inProfiles = await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`);
  console.log("rows in auth.users:", inAuth?.c, "| rows in profiles:", inProfiles?.c);

  if (r.status >= 200 && r.status < 300 && inAuth?.c === 0 && inProfiles?.c === 0) {
    console.log("\nPROBE PASSED: SECURITY DEFINER function can hard-delete from auth.users");
  } else {
    console.log("\nPROBE FAILED: function could not hard-delete");
  }
} catch (e) {
  console.error("PROBE ERROR:", e.message);
} finally {
  // cleanup: drop the function, then remove test users
  await sql(`DROP FUNCTION IF EXISTS public.admin_delete_user(TEXT)`).catch(() => {});
  for (const u of [admin, victim]) {
    if (u) await sql(`DELETE FROM auth.users WHERE id = ${q(u.id)}`).catch(() => {});
  }
  console.log("cleanup done");
}
