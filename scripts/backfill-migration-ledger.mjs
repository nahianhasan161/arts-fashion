import fs from "fs";

/**
 * One-off: record already-applied migrations in the ledger.
 *
 * The 2026-09-25/26 migrations were applied out of band before the ledger was
 * in use, so `scripts/apply-sql.mjs` would try to re-run them and fail on
 * non-idempotent DDL. Each file is only recorded after its expected objects
 * are confirmed to exist, so a migration that never finished applying is left
 * unrecorded and will still be run.
 */

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(1);
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** Wrap text in dollar quoting with a delimiter the text cannot contain. */
function dollar(text) {
  let tag = "$ledger$";
  while (text.includes(tag)) tag = "$" + tag.slice(1) + "x$";
  return `${tag}${text}${tag}`;
}

async function run(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 400) throw new Error(t.substring(0, 300));
  return t ? JSON.parse(t) : [];
}

/** Objects each migration must have created for it to count as applied. */
const EXPECT = {
  20260925100000: [["table", "colors"]],
  20260926120000: [
    ["table", "size_regions"],
    ["table", "size_measurements"],
    ["fn", "fmt_num"],
  ],
  20260926121000: [["count", "public.size_measurements", 21]],
  20260926130000: [["table", "promotions"]],
  20260926131000: [["fn", "get_effective_price"], ["fn", "get_effective_prices"]],
  20260926132000: [["fn", "admin_save_promotion"]],
  20260926133000: [["fn", "create_order_with_reservations"]],
  20260926140000: [["fn", "get_effective_badges"], ["fn", "best_active_promotion"]],
  20260926150000: [
    ["table", "coupons"],
    ["table", "user_groups"],
    ["table", "coupon_redemptions"],
  ],
  20260926151000: [["fn", "coupon_quote"], ["fn", "validate_coupon"]],
  20260926152000: [["fn", "coupon_allocations"]],
  20260926153000: [["fn", "admin_save_coupon"]],
  20260926154000: [["fn", "resolve_order_variant"]],
  20260926160000: [
    ["table", "product_images"],
    ["fn", "storage_public_url"],
    ["fn", "admin_add_product_image"],
  ],
};

const files = fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
let ok = 0;
const bad = [];

for (const f of files) {
  const version = (f.match(/^(\d+)/) ?? [])[1];
  if (!EXPECT[version]) continue;

  const missing = [];
  for (const [kind, name, min] of EXPECT[version]) {
    if (kind === "table") {
      const r = await run(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=${q(name)}`
      );
      if (!r.length) missing.push(`table ${name}`);
    } else if (kind === "fn") {
      const r = await run(
        `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=${q(name)}`
      );
      if (!r.length) missing.push(`fn ${name}`);
    } else {
      const r = await run(`SELECT count(*)::int c FROM ${name}`);
      if (r[0].c < min) missing.push(`${name} has ${r[0].c} < ${min}`);
    }
  }

  if (missing.length) {
    bad.push(`${f}: ${missing.join(", ")}`);
    continue;
  }

  const stem = f.replace(/\.sql$/, "");
  const sql = fs.readFileSync(`supabase/migrations/${f}`, "utf8");
  await run(
    `INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
     VALUES (${q(version)}, ARRAY[${dollar(sql)}]::TEXT[], ${q(stem)})
     ON CONFLICT (version) DO NOTHING`
  );
  ok++;
  console.log(`  recorded  ${f}`);
}

console.log(`\nrecorded ${ok}`);
if (bad.length) {
  console.log(`\nNOT recorded, objects missing:\n  ${bad.join("\n  ")}`);
  process.exitCode = 1;
}
