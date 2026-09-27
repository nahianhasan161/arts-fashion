import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Applies supabase/migrations/*.sql through the Supabase Management API.
 *
 * The CLI cannot reach the database in this environment, so migrations are
 * executed here instead. Each file is recorded in
 * supabase_migrations.schema_migrations, which is the table the Supabase CLI
 * also reads, so `supabase db push` will not try to re-apply them.
 *
 * Usage:
 *   node scripts/apply-sql.mjs            # apply pending migrations
 *   node scripts/apply-sql.mjs --only 20260927100000
 *   node scripts/apply-sql.mjs --force    # re-apply every file
 *
 * `--only` re-applies a single file that has already run. It exists because
 * `--force` replays the whole directory from the beginning, and the earliest
 * migrations are not idempotent (they create policies without dropping them
 * first), so replaying them aborts before reaching the file being fixed.
 * Each migration in this project is written to be safely re-runnable on its
 * own, so targeting one is both possible and the normal way to amend one.
 *
 * Requires SUPABASE_ACCESS_TOKEN in the environment. The token is never
 * written to this file.
 */

const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.env.SUPABASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const force = process.argv.includes("--force");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? null : (process.argv[onlyIndex + 1] ?? "");

if (!accessToken) {
  console.error("SUPABASE_ACCESS_TOKEN is not set. Export it and try again.");
  process.exit(1);
}

async function run(sql, label) {
  const resp = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const text = await resp.text();
  if (resp.status >= 400) {
    console.error(`\nFAILED [${label}]:\n${text.substring(0, 900)}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : [];
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const applied = new Set(
  (await run("SELECT version FROM supabase_migrations.schema_migrations", "read ledger"))
    .map((r) => r.version)
);

const dir = "supabase/migrations";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

let count = 0;
for (const f of files) {
  // This project's ledger stores the numeric prefix as `version` and the
  // rest of the filename as `name`, so match that convention when checking
  // what has already run.
  const stem = f.replace(/\.sql$/, "");
  const version = (stem.match(/^(\d+)/) ?? [stem, stem])[1];
  if (only && !(stem.includes(only) || version === only)) {
    continue;
  }
  if (!force && !only && applied.has(version)) {
    console.log(`  --  ${f} (already applied)`);
    continue;
  }

  console.log(`\n== ${f}`);
  const sql = readFileSync(join(dir, f), "utf8");
  await run(sql, f);

  // Recorded as an array of one statement so the ledger treats the file as
  // a single applied migration.
  await run(
    `INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
     VALUES (${q(version)}, ARRAY[${q(sql)}]::TEXT[], ${q(stem)})
     ON CONFLICT (version) DO NOTHING`,
    `${f} ledger`
  );
  count++;
}

console.log(
  count === 0 ? "\nnothing to apply" : `\napplied ${count} migration${count === 1 ? "" : "s"}`
);
