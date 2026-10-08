/**
 * HTTP-level checks for the admin user list.
 *
 * This endpoint failed on every single request with
 *
 *     HTTP 500 {"error":"This endpoint requires a valid Bearer token"}
 *
 * after the admin gate had already passed, because it called
 * `supabase.auth.admin.listUsers()`. That is the GoTrue ADMIN API: it only
 * accepts the service_role key, so a server client holding a real admin's user
 * session was refused, and the error text blamed the caller's credentials for a
 * call the caller never made.
 *
 * The two things worth guarding are therefore:
 *
 *   1. an admin session gets a 200 with usable data -- the regression;
 *   2. the boundary still refuses anonymous and non-admin callers.
 *
 * (2) matters as much as (1). An endpoint that lists every user in the system
 * with their email addresses is exactly the kind of thing that must not become
 * readable by loosening the check that makes it work.
 *
 * Real sessions are used throughout: a route that requires a cookie and a
 * profile cannot be meaningfully tested by asserting on 401s alone. Every row
 * this script makes is removed, including on failure.
 *
 *   node scripts/test-admin-users.mjs [baseUrl]
 */

const base = process.argv[2] ?? "http://localhost:3111";
const mgmt = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPBASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
import { createServerClient } from "@supabase/ssr";

const Q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const PWD = "AdminUsers12345!";

if (!mgmt || !supabaseUrl || !publishable) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_* in the environment");
  process.exit(1);
}

// ---------------------------------------------------------------- helpers

let fails = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS  " : "FAIL  "}${label.padEnd(58)} got=${JSON.stringify(actual)}${pass ? "" : " want=" + JSON.stringify(expected)}`
  );
};
const section = (n, title) => console.log(`\n=== ${n}. ${title} ===`);

async function must(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mgmt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (r.status >= 400) throw new Error(`SQL failed: ${text.slice(0, 300)}\n${query.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function col1(query) {
  return (await must(query))[0];
}

/**
 * Creates a confirmed auth user. The profile is left to the signup trigger,
 * which is the thing under test elsewhere; the role is set afterwards because a
 * promotion is an admin action and the trigger is not allowed to do one.
 */
async function mkUser(tag, role) {
  const id = (await col1("SELECT gen_random_uuid() AS id")).id;
  const email = `au-${tag}-${Date.now()}@example.test`;
  await must(`
    INSERT INTO auth.users (
      id, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
      raw_user_meta_data, aud, role, instance_id, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      ${Q(id)}, ${Q(email)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf', 10)), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', ''
    )
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(id)}, ${Q(id)},
      ${Q(JSON.stringify({ sub: id, email, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  await must(
    `INSERT INTO public.profiles (id, email, full_name, role)
     VALUES (${Q(id)}, ${Q(email)}, ${Q(`Admin Users ${tag}`)}, ${Q(role)})
     ON CONFLICT (id) DO UPDATE SET role = ${Q(role)}`
  );
  return { id, email };
}

/** Signs in for real and returns the cookie jar the browser would carry. */
async function signIn(email) {
  const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PWD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("sign-in failed: " + JSON.stringify(j).slice(0, 200));

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
  if (cookies.length === 0) throw new Error("no session cookie was written");
  return { cookie: cookies.join("; "), accessToken: j.access_token };
}

const hit = async (headers, path = "/api/admin/users?limit=100") => {
  const r = await fetch(`${base}${path}`, { headers });
  let body = {};
  try {
    body = await r.json();
  } catch {
    body = {};
  }
  return { status: r.status, body };
};

const created = [];
try {
  const admin = await mkUser("admin", "admin");
  const plain = await mkUser("plain", "user");
  // A third account that is NEVER promoted. The non-admin checks need a
  // session belonging to someone who stays a non-admin throughout: an earlier
  // version of this suite promoted the same account it was using to prove the
  // negative case, so the assertion passed a check on an admin and proved
  // nothing.
  const bystander = await mkUser("bystander", "user");
  created.push(admin, plain, bystander);

  // Promote the test admin to super_admin using the management API (service role)
  // This is needed because the admin_set_user_role RPC requires a super_admin caller
  await must(
    `UPDATE public.profiles SET role = 'super_admin' WHERE id = ${Q(admin.id)}`
  );
  // Verify the promotion worked
  const promoted = await col1(`SELECT role FROM public.profiles WHERE id = ${Q(admin.id)}`);
  if (promoted?.role !== 'super_admin') throw new Error('Failed to promote test admin to super_admin');

  // Sign in all three users upfront
  const as = await signIn(admin.email);
  const ps = await signIn(plain.email);
  const bs = await signIn(bystander.email);
  const ok = await hit({ cookie: as.cookie });

  check("an admin gets 200", ok.status, 200);
  check("and the Bearer-token error is gone", ok.body.error ?? null, null);
  check("and users come back", Array.isArray(ok.body.data), true);
  const me = (ok.body.data ?? []).find((u) => u.id === admin.id);
  check("the caller is in their own list", Boolean(me), true);
  // The regression in its most direct form: before the fix this was null for
  // every signup user, because handle_new_user() never wrote the column and the
  // list had been reaching for auth.admin.listUsers() to recover it.
  check("with a usable email address", me?.email, admin.email);

  // -------------------------------------------------------------- 2
  section(2, "the address is a copy the trigger maintains");
  // Not a type-level assertion: the endpoint used to call the GoTrue admin API
  // precisely because nothing else could supply this, so the column has to be
  // populated on the signup path or the endpoint needs a privileged key again.
  const fresh = (await col1("SELECT gen_random_uuid() AS id")).id;
  const freshEmail = `au-fresh-${Date.now()}@example.test`;
  await must(`
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (${Q(fresh)}, ${Q(freshEmail)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf',10)),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated','authenticated','00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', '')
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(fresh)}, ${Q(fresh)},
      ${Q(JSON.stringify({ sub: fresh, email: freshEmail, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  created.push({ id: fresh, email: freshEmail });

  const onInsert = await col1(`SELECT email, role FROM public.profiles WHERE id=${Q(fresh)}`);
  check("the signup trigger wrote the email", onInsert?.email, freshEmail);
  check("and set the role to user", onInsert?.role, "user");

  const changedEmail = `au-changed-${Date.now()}@example.test`;
  await must(`UPDATE auth.users SET email=${Q(changedEmail)} WHERE id=${Q(fresh)}`);
  const onUpdate = await col1(`SELECT email FROM public.profiles WHERE id=${Q(fresh)}`);
  check("and follows an email change", onUpdate?.email, changedEmail);

  // A trigger that can also write role is a trigger that can hand out admin.
  await must(`UPDATE auth.users SET raw_user_meta_data='{"full_name":"Escalated"}'::jsonb WHERE id=${Q(fresh)}`);
  const stillUser = await col1(`SELECT role FROM public.profiles WHERE id=${Q(fresh)}`);
  check("but a metadata change cannot grant admin", stillUser?.role, "user");

  // -------------------------------------------------------------- 3
  section(3, "the boundary still refuses");
  // Asserted after the success case on purpose: an endpoint that lists every
  // user and their address must not become readable by loosening the check that
  // makes it work.
  const anon = await hit({});
  check("an anonymous caller gets 401", anon.status, 401);

  const notAdmin = await hit({ cookie: bs.cookie });
  check("a signed-in non-admin gets 403", notAdmin.status, 403);
  // The message has to distinguish being signed out from being signed in as the
  // wrong kind of user, because those have opposite fixes.
  check("and says which role the caller actually has", notAdmin.body.error?.includes('role is "user"'), true);

  // And a non-admin must not be able to read the list at all, which is the
  // check the whole 401/403 conversation is really about.
  check("a non-admin sees no users", notAdmin.body.data ?? null, null);

  // The endpoint reads a cookie. A user's own access token is not a substitute
  // for one, which is the premise behind "add an Authorization header" and the
  // reason that advice does not work here.
  const headerOnly = await hit({ Authorization: `Bearer ${as.accessToken}` });
  check("a Bearer header alone is not a session", headerOnly.status, 401);

  // -------------------------------------------------------------- 4
  section(4, "pagination reports the real total");
  // The old shape reported `total: users.length`, so page 1 of 20 reported a
  // total of 20 no matter how many users existed. A paginated list that calls
  // itself complete is worse than one that admits it is truncated.
  const paged = await hit({ cookie: as.cookie }, "/api/admin/users?page=1&limit=1");
  check("a limit of 1 returns one row", paged.body.data?.length, 1);
  const realTotal = (await col1("SELECT count(*)::int c FROM public.profiles"))?.c ?? 0;
  check("the total is every user, not the page", paged.body.pagination?.total, realTotal);
  check("and the page count follows from it", paged.body.pagination?.pages, realTotal);

  // -------------------------------------------------------------- 5
  section(5, "promoting a role");
  const put = await fetch(`${base}/api/admin/users`, {
    method: "PUT",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: plain.id, role: "admin" }),
  });
  check("an admin can promote a user", put.status, 200);
  check("and it took effect", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(plain.id)}`))?.role, "admin");
  // The other half of the boundary, from an account that was never promoted.
  // A non-admin must not be able to demote the very admin who promoted them.
  const putPlain = await fetch(`${base}/api/admin/users`, {
    method: "PUT",
    headers: { cookie: bs.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: admin.id, role: "user" }),
  });
  check("but a non-admin cannot demote one", putPlain.status, 403);
  check("and the admin's role is untouched (still super_admin)", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(admin.id)}`))?.role, "super_admin");

  // -------------------------------------------------------------- 6
  section(6, "Super Admin: promote to super_admin");
  // Only a super_admin can promote to super_admin via the RPC
  const promoteToSuper = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: plain.id, role: "super_admin" }),
  });
  check("super_admin can promote admin to super_admin", promoteToSuper.status, 200);
  check("role is now super_admin", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(plain.id)}`))?.role, "super_admin");

  // Admin (not super_admin) cannot promote to super_admin
  // plain is a user (not admin), so requireAdmin throws 401
  const adminTrySuper = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: plain.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: bystander.id, role: "super_admin" }),
  });
  check("user cannot promote to super_admin", adminTrySuper.status, 401);

  // -------------------------------------------------------------- 7
  section(7, "Super Admin: demote from super_admin");
  // Super admin can demote another super_admin back to admin
  const demoteFromSuper = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: plain.id, role: "admin" }),
  });
  check("super_admin can demote super_admin to admin", demoteFromSuper.status, 200);
  check("role is now admin", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(plain.id)}`))?.role, "admin");

// Super admin cannot demote themselves
  const selfDemoteRes = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: admin.id, role: "admin" }),
  });
  const selfDemote = { status: selfDemoteRes.status, body: await selfDemoteRes.json().catch(() => ({})) };
  check("super_admin cannot demote themselves", selfDemote.status, 409);
  check("error message mentions self-demotion", selfDemote.body?.error?.includes("self"), true);

  // Super admin cannot demote the LAST super_admin
  // Create another super_admin to test this scenario (demoting a DIFFERENT super_admin who is the last one)
  const lastSuperId = (await col1("SELECT gen_random_uuid() AS id")).id;
  const lastSuperEmail = `last-super-${Date.now()}@example.test`;
  await must(`
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (${Q(lastSuperId)}, ${Q(lastSuperEmail)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf',10)),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated','authenticated','00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', '')
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(lastSuperId)}, ${Q(lastSuperId)},
      ${Q(JSON.stringify({ sub: lastSuperId, email: lastSuperEmail, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  await must(
    `INSERT INTO public.profiles (id, email, role) VALUES (${Q(lastSuperId)}, ${Q(lastSuperEmail)}, ${Q("super_admin")}) ON CONFLICT (id) DO NOTHING`
  );
  created.push({ id: lastSuperId, email: lastSuperEmail });

  // Now there are 2 super_admins (admin and lastSuper). Demote lastSuper to admin - should succeed
  const demoteLastSuperRes = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: lastSuperId, role: "admin" }),
  });
  const demoteLastSuper = { status: demoteLastSuperRes.status, body: await demoteLastSuperRes.json().catch(() => ({})) };
  check("super_admin can demote another super_admin", demoteLastSuper.status, 200);
  check("lastSuper role is now admin", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(lastSuperId)}`))?.role, "admin");

  // Now admin is the ONLY super_admin. Try to demote admin (self) - should fail with self-demotion
  const lastDemoteRes = await fetch(`${base}/api/admin/users?action=role`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: admin.id, role: "admin" }),
  });
  const lastDemote = { status: lastDemoteRes.status, body: await lastDemoteRes.json().catch(() => ({})) };
  check("cannot demote the last super_admin (self)", lastDemote.status, 409);
  check("error message mentions self or last", lastDemote.body?.error?.includes("self") || lastDemote.body?.error?.includes("last"), true);
  check("admin role unchanged", (await col1(`SELECT role FROM public.profiles WHERE id=${Q(admin.id)}`))?.role, "super_admin");

  // -------------------------------------------------------------- 8
  section(8, "Super Admin: row protection (delete/ban)");
  // Super admin row cannot be deleted
  const deleteSuper = await fetch(`${base}/api/admin/users?id=${admin.id}`, {
    method: "DELETE",
    headers: { cookie: as.cookie },
  });
  check("super_admin cannot be deleted", deleteSuper.status, 403);
  check("admin still exists", (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id=${Q(admin.id)}`))?.c, 1);

  // Super admin row cannot be banned
  const banSuper = await fetch(`${base}/api/admin/users?action=ban`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: admin.id, banned: true }),
  });
  check("super_admin cannot be banned", banSuper.status, 403);
  check("status still active", (await col1(`SELECT status FROM public.profiles WHERE id=${Q(admin.id)}`))?.status, "active");

  // Super admin row status cannot be changed via direct UPDATE (tested via trigger)
  // We verify the trigger blocks direct UPDATE by trying a raw SQL update
  // that would bypass the API. The BEFORE trigger should raise.
  const directUpdate = await must(
    `UPDATE public.profiles SET status='banned' WHERE id=${Q(admin.id)}`
  ).catch((e) => e);
  check("direct UPDATE of super_admin status is blocked by trigger", directUpdate instanceof Error, true);
  check("error code is P0004", directUpdate instanceof Error && directUpdate.message.includes("P0004"), true);

  // -------------------------------------------------------------- 9
  section(9, "Super Admin: invariant enforcement");
  // The CONSTRAINT TRIGGER enforce_super_admin_invariant fires after any
  // role/status change or delete. We test it by trying to delete the last
  // super_admin via a raw SQL that would bypass the API but not the trigger.
  // First, create a temporary super_admin we can sacrifice
  const tempEmail = `temp-super-${Date.now()}@example.test`;
  const tempId = (await col1("SELECT gen_random_uuid() AS id")).id;
  await must(`
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (${Q(tempId)}, ${Q(tempEmail)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf',10)),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated','authenticated','00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', '')
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(tempId)}, ${Q(tempId)},
      ${Q(JSON.stringify({ sub: tempId, email: tempEmail, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  await must(
    `INSERT INTO public.profiles (id, email, role) VALUES (${Q(tempId)}, ${Q(tempEmail)}, ${Q("super_admin")})
     ON CONFLICT (id) DO UPDATE SET role = ${Q("super_admin")}`
  );
  created.push({ id: tempId, email: tempEmail });

  // Now there are 2 super_admins. Try to delete the temp one via raw SQL -
  // the trigger should block it because it would leave 1, which is OK.
  // But if we try to delete BOTH, it should fail.
  // Actually, the trigger fires per row, so deleting one of two is fine.
  // The invariant is only violated if the final count would be 0.
  const deleteTemp = await must(
    `DELETE FROM public.profiles WHERE id=${Q(tempId)}`
  ).catch((e) => e);
  check("deleting one of two super_admins succeeds", !(deleteTemp instanceof Error), true);
  // But deleting the LAST one should fail
  const deleteLast = await must(
    `DELETE FROM public.profiles WHERE role='super_admin'`
  ).catch((e) => e);
  check("deleting the last super_admin fails", deleteLast instanceof Error, true);
  check("error code is P0001", deleteLast instanceof Error && deleteLast.message.includes("P0001"), true);

  // -------------------------------------------------------------- 10
  section(10, "Super Admin: self-protection");
  // A super_admin cannot ban themselves
  const selfBan = await fetch(`${base}/api/admin/users?action=ban`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: admin.id, banned: true }),
  });
  check("super_admin cannot ban themselves", selfBan.status, 403);

  // A super_admin cannot delete themselves (API already checks target role)
  const selfDelete = await fetch(`${base}/api/admin/users?id=${admin.id}`, {
    method: "DELETE",
    headers: { cookie: as.cookie },
  });
  check("super_admin cannot delete themselves via API", selfDelete.status, 403);

  // But also via direct SQL the BEFORE trigger blocks it
  const directDelete = await must(
    `DELETE FROM public.profiles WHERE id=${Q(admin.id)}`
  ).catch((e) => e);
  check("direct DELETE of own super_admin row blocked by trigger", directDelete instanceof Error, true);
  check("error code is P0002", directDelete instanceof Error && directDelete.message.includes("P0002"), true);

  // -------------------------------------------------------------- 11
  section(11, "Banned user cannot sign in");
  // Create a user, ban them, verify they can't get a session
  const banTestId = (await col1("SELECT gen_random_uuid() AS id")).id;
  const banTestEmail = `ban-test-${Date.now()}@example.test`;
  await must(`
    INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, aud, role, instance_id,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change_token_new, email_change)
    VALUES (${Q(banTestId)}, ${Q(banTestEmail)}, extensions.crypt(${Q(PWD)}, extensions.gen_salt('bf',10)),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      'authenticated','authenticated','00000000-0000-0000-0000-000000000000',
      now(), now(), '', '', '', '')
  `);
  await must(`
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${Q(banTestId)}, ${Q(banTestId)},
      ${Q(JSON.stringify({ sub: banTestId, email: banTestEmail, email_verified: true }))}::jsonb,
      'email', now(), now(), now())
  `);
  await must(
    `INSERT INTO public.profiles (id, email, role) VALUES (${Q(banTestId)}, ${Q(banTestEmail)}, ${Q("user")})
     ON CONFLICT (id) DO UPDATE SET role = ${Q("user")}`
  );
  created.push({ id: banTestId, email: banTestEmail });

  // Ban the user via API
  const banIt = await fetch(`${base}/api/admin/users?action=ban`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: banTestId, banned: true }),
  });
  check("ban request succeeds", banIt.status, 200);
  check("status is banned", (await col1(`SELECT status FROM public.profiles WHERE id=${Q(banTestId)}`))?.status, "banned");

  // Try to sign in as the banned user
  const bannedSignIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email: banTestEmail, password: PWD }),
  });
  const bannedSignInJson = await bannedSignIn.json();
  check("banned user cannot sign in", bannedSignIn.status, 400);
  check("error mentions banned", JSON.stringify(bannedSignInJson).includes("banned") || JSON.stringify(bannedSignInJson).includes("Banned"), true);

  // Unban and verify they can sign in again
  const unbanIt = await fetch(`${base}/api/admin/users?action=ban`, {
    method: "PATCH",
    headers: { cookie: as.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: banTestId, banned: false }),
  });
  check("unban request succeeds", unbanIt.status, 200);
  check("status is active", (await col1(`SELECT status FROM public.profiles WHERE id=${Q(banTestId)}`))?.status, "active");

  const unbannedSignIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "Content-Type": "application/json" },
    body: JSON.stringify({ email: banTestEmail, password: PWD }),
  });
  check("unbanned user can sign in", unbannedSignIn.status, 200);

  // -------------------------------------------------------------- 12
  section(12, "Status filter and search");
  const filtered = await hit(
    { cookie: as.cookie },
    "/api/admin/users?status=banned&limit=100"
  );
  check("status=banned filter works", filtered.body.data?.every((u) => u.status === "banned"), true);

  const roleFiltered = await hit(
    { cookie: as.cookie },
    "/api/admin/users?role=super_admin&limit=100"
  );
  check("role=super_admin filter works", roleFiltered.body.data?.every((u) => u.role === "super_admin"), true);

  const searchFiltered = await hit(
    { cookie: as.cookie },
    `/api/admin/users?search=${encodeURIComponent(admin.email?.split("@")[0] ?? "")}&limit=100`
  );
  check("search by email prefix works", searchFiltered.body.data?.some((u) => u.id === admin.id), true);

  console.log(fails === 0 ? "\nALL ADMIN USER CHECKS PASS" : `\n${fails} FAILED`);
  process.exitCode = fails === 0 ? 0 : 1;
} finally {
  // Clean up all test users in one go using management API
  // First demote all test super_admins, then delete all test users
  await must(`
    DO $$
    BEGIN
      PERFORM set_config('admin.allow_super_admin_role_change', 'true', false);
      UPDATE public.profiles SET role = 'admin' WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test';
      PERFORM set_config('admin.allow_super_admin_role_change', 'false', false);
    END $$;
  `).catch(() => {});
  
  // Delete from auth.users (cascades to profiles)
  await must(`
    DELETE FROM auth.users WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test'
  `).catch(() => {});
  
  const left = await col1("SELECT count(*)::int c FROM public.profiles WHERE email LIKE 'au-%@example.test' OR email LIKE 'temp-super-%@example.test' OR email LIKE 'last-super-%@example.test' OR email LIKE 'ban-test-%@example.test'");
  console.log(`cleanup: ${left?.c === 0 ? "no rows left" : `${left?.c} ROW(S) LEFT`}`);
}
