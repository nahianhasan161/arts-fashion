/**
 * Diagnostic: can postgres delete from public.profiles
 * directly? And is the profile re-created afterwards
 * (which would implicate the handle_new_user trigger)?
 *
 * Also: who owns the profiles cascade trigger?
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
  if (r.status >= 400) throw new Error(`SQL failed: ${text.slice(0, 300)}\n${query.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function col1(query) {
  return (await sql(query))[0];
}

const PWD = "DeleteProbe12345!";

async function mkUser(tag) {
  const id = (await col1("SELECT gen_random_uuid() AS id")).id;
  const email = `prof-${tag}-${Date.now()}@example.test`;
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
  return { id, email };
}

let victim = null;

try {
  victim = await mkUser("victim");
  console.log("created victim:", victim.email, victim.id);

  // Direct delete of the profile row
  const before = (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`))?.c;
  console.log("profile rows BEFORE direct profile delete:", before);

  await sql(`DELETE FROM public.profiles WHERE id = ${q(victim.id)}`);
  console.log("direct DELETE FROM public.profiles executed");

  const after = (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`))?.c;
  console.log("profile rows AFTER direct profile delete:", after);

  // Wait and check for re-creation
  await new Promise((r) => setTimeout(r, 1500));
  const recreated = (await col1(`SELECT count(*)::int c FROM public.profiles WHERE id = ${q(victim.id)}`))?.c;
  console.log("profile rows after 1.5s wait (re-creation check):", recreated);

  console.log("\nAnalysis:");
  console.log("  postgres can delete profile directly:", after === 0);
  console.log("  profile re-created by trigger:", recreated === 1);
} catch (e) {
  console.error("DIAG ERROR:", e.message);
} finally {
  if (victim) await sql(`DELETE FROM auth.users WHERE id = ${q(victim.id)}`).catch(() => {});
  console.log("cleanup done");
}
