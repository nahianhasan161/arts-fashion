/**
 * Test: does the Supabase Management API's auth-user
 * deletion endpoint (DELETE /v1/projects/{ref}/auth/users/{id})
 * properly hard-delete a user AND cascade to public.profiles?
 *
 * This uses SUPABASE_ACCESS_TOKEN, which is already in the
 * environment (used by apply-sql.mjs). If this works, it is
 * the cleanest hard-delete path that needs no service_role key.
 */
const ref = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const token = process.env.SUPABASE_ACCESS_TOKEN;
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

const PWD = "DeleteProbe12345!";

async function mkUser(tag) {
  const id = (await col1("SELECT gen_random_uuid() AS id")).id;
  const email = `mgmt-${tag}-${Date.now()}@example.test`;
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
  return { id, email };
}

let victim = null;

try {
  victim = await mkUser("victim");
  console.log("created victim:", victim.email, victim.id);

  const beforeAuth = await col1(`SELECT count(*)::int c FROM auth.users WHERE id = ${q(victim.id)}`);
  const beforeProf = await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`);
  console.log("BEFORE -> auth.users:", beforeAuth?.c, "| profiles:", beforeProf?.c);

  // Hard delete via the Management API auth-users endpoint
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/auth/users/${victim.id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  console.log("Management API DELETE status:", r.status, await r.text().catch(() => ""));

  const afterAuth = await col1(`SELECT count(*)::int c FROM auth.users WHERE id = ${q(victim.id)}`);
  const afterProf = await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`);
  const afterIdent = await col1(`SELECT count(*)::int c FROM auth.identities WHERE user_id = ${q(victim.id)}`);
  console.log("AFTER  -> auth.users:", afterAuth?.c, "| profiles:", afterProf?.c, "| identities:", afterIdent?.c);

  if (r.status < 300 && afterAuth?.c === 0 && afterProf?.c === 0 && afterIdent?.c === 0) {
    console.log("\nMGMT API DELETE WORKS: user + profile + identities all removed");
  } else {
    console.log("\nMGMT API DELETE INCOMPLETE");
  }
} catch (e) {
  console.error("TEST ERROR:", e.message);
} finally {
  if (victim) await sql(`DELETE FROM auth.users WHERE id = ${q(victim.id)}`).catch(() => {});
  console.log("cleanup done");
}
