/**
 * Copies existing media from Supabase Storage into Tigris.
 *
 *   node scripts/tigris-migrate-objects.mjs           report what would move
 *   node scripts/tigris-migrate-objects.mjs --run     do it
 *
 * Nothing in the database is changed by this script. The URL projection is
 * repointed by the SQL migration, which is applied separately and only after
 * this has run, so the storefront is never pointed at a bucket that does not
 * yet hold its files.
 *
 * Order matters, and running it in the other order is the mistake worth
 * avoiding:
 *
 *   1. this script   -- the bytes exist in Tigris
 *   2. the migration  -- the projection points at Tigris
 *
 * Both are idempotent. A key already present in Tigris is skipped rather than
 * re-copied, so an interrupted run can simply be repeated.
 *
 * Objects are downloaded with the Supabase service key and uploaded with the
 * Tigris keys. The old objects are NOT deleted. Removing them is a separate,
 * deliberate step: until the projection has been repointed and verified, the
 * storefront may still be reading from Supabase, and a file deleted too early
 * is a broken image with no way back.
 */

import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const p = join(root, file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const RUN = process.argv.includes("--run");
const BUCKET = process.env.TIGRIS_STORAGE_BUCKET || "artsfashion-media";
const endpoint = (process.env.TIGRIS_STORAGE_ENDPOINT || "").replace(/\/+$/, "");
const OLD_BUCKET = "product-images";

for (const k of ["TIGRIS_STORAGE_ENDPOINT", "TIGRIS_STORAGE_ACCESS_KEY_ID", "TIGRIS_STORAGE_SECRET_ACCESS_KEY", "SUPABASE_ACCESS_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"]) {
  if (!process.env[k]) {
    console.error(`Missing ${k}.`);
    process.exit(1);
  }
}
const SUPABASE_PROJECT_REF = process.env.SUPBASE_PROJECT_REF ?? "khebwqdhucrdfpfadxry";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const tigris = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
  },
});

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (r.status >= 400) throw new Error(`SQL failed: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const say = (l, v) => console.log(`  ${l.padEnd(32)} ${v}`);

console.log(`\nMigrate media: ${OLD_BUCKET} (Supabase) -> ${BUCKET} (Tigris)`);
say("mode", RUN ? "RUN -- objects will be copied" : "dry run (use --run to copy)");

// The paths are read from the database rather than from the bucket listing, so
// the set is exactly the objects a row points at. An object with no row is
// invisible here and is not a broken image, so it is not this script's concern.
const rows = await sql(`
  SELECT 'product_images' AS tbl, id, storage_path, mime_type FROM public.product_images
  UNION ALL
  SELECT 'media_attachments', id, storage_path, mime_type FROM public.media_attachments
`);

say("rows referencing a path", rows.length);
if (rows.length === 0) {
  console.log("\nNothing to migrate.\n");
  process.exit(0);
}

// A public Supabase Storage URL serves the bytes without credentials, so no
// service-role header is needed and the download path does not depend on a key
// that the Management API cannot use anyway.
const oldUrl = (p) =>
  `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${OLD_BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`;

let copied = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  try {
    try {
      await tigris.send(new HeadObjectCommand({ Bucket: BUCKET, Key: row.storage_path }));
      say(row.storage_path, "already in Tigris, skipping");
      skipped++;
      continue;
    } catch {
      /* not present, which is the case that matters */
    }

    const res = await fetch(oldUrl(row.storage_path));
    if (!res.ok) {
      say(row.storage_path, `MISSING in Supabase (${res.status})`);
      failed++;
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());

    if (!RUN) {
      say(row.storage_path, `would copy ${bytes.length} bytes`);
      continue;
    }

    await tigris.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: row.storage_path,
        Body: bytes,
        ContentType: row.mime_type || res.headers.get("content-type") || "application/octet-stream",
      }),
    );
    say(row.storage_path, `copied ${bytes.length} bytes`);
    copied++;
  } catch (e) {
    say(row.storage_path, `FAILED ${e?.name}: ${String(e?.message).slice(0, 80)}`);
    failed++;
  }
}

console.log(`\n  ${"copied".padEnd(32)} ${copied}`);
console.log(`  ${"already present".padEnd(32)} ${skipped}`);
console.log(`  ${"failed".padEnd(32)} ${failed}`);

if (RUN) {
  if (failed > 0) {
    console.log(
      `\nSome objects did not copy. Fix those before continuing -- the URL migration\n` +
        `is not safe to apply while a referenced object is missing from Tigris.\n`
    );
    process.exit(1);
  }
  console.log(
    `\nNext step: apply the SQL migration, which repoints products.images at Tigris:\n` +
      `    node scripts/apply-sql.mjs --only 20260927120000\n` +
      `It rewrites the URL projection only. It does not delete the Supabase objects,\n` +
      `so a mistake is recoverable by pointing media_url_prefix back.\n`
  );
} else {
  console.log(`\nRe-run with --run to copy.\n`);
}
