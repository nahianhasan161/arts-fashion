/**
 * Diagnostic: when a row is deleted from auth.users,
 * which child tables actually cascade? Check auth.users,
 * public.profiles, AND auth.identities. Also dump the
 * surviving profile row to see its exact state.
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
  const email = `casc-${tag}-${Date.now()}@example.test`;
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

  const before = {
    auth: (await col1(`SELECT count(*)::int c FROM auth.users WHERE id = ${q(victim.id)}`))?.c,
    profiles: (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`))?.c,
    identities: (await col1(`SELECT count(*)::int c FROM auth.identities WHERE user_id = ${q(victim.id)}`))?.c,
  };
  console.log("BEFORE:", JSON.stringify(before));

  await sql(`DELETE FROM auth.users WHERE id = ${q(victim.id)}`);
  console.log("DELETE FROM auth.users executed");

  const after = {
    auth: (await col1(`SELECT count(*)::int c FROM auth.users WHERE id = ${q(victim.id)}`))?.c,
    profiles: (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`))?.c,
    identities: (await col1(`SELECT count(*)::int c FROM auth.identities WHERE user_id = ${q(victim.id)}`))?.c,
  };
  console.log("AFTER:", JSON.stringify(after));

  // Dump the surviving profile row
  const prof = await col1(`SELECT id, email, role, status, deleted_at FROM public.profiles WHERE id = ${q(victim.id)}`);
  console.log("surviving profile row:", JSON.stringify(prof));

  console.log("\nAnalysis:");
  console.log("  auth.users cascaded:", after.auth === 0);
  console.log("  identities cascaded:", after.identities === 0);
  console.log("  profiles cascaded:", after.profiles === 0);
} catch (e) {
  console.error("DIAG ERROR:", e.message);
} finally {
  if (victim) await sql(`DELETE FROM auth.users WHERE id = ${q(victim.id)}`).catch(() => {});
  console.log("cleanup done");
}
