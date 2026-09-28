/**
 * Prepares the Tigris bucket and reports what still has to be done by hand.
 *
 *   node scripts/tigris-setup.mjs            prepare and verify
 *   node scripts/tigris-setup.mjs --delete   remove the probe object
 *
 * Reads the same environment variables the app does, so a bucket that works
 * here is a bucket the app can use. Everything is idempotent: running it twice
 * creates nothing the second time.
 *
 * The one thing it cannot do is make the bucket public. Tigris answers
 * PaymentVerificationRequired until a payment method is verified on the
 * account, and that is a dashboard action. The script says so explicitly rather
 * than reporting a failure, because a first run that creates the bucket and
 * stops there is the expected outcome, not a problem to debug.
 */

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutBucketAclCommand,
} from "@aws-sdk/client-s3";

// .env.local is what Next loads first, .env second; this script reads the file
// directly rather than relying on the shell, so it behaves the same however it
// is invoked. Values already in the environment win, which is how CI would
// pass them.
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
    // An existing value is not overwritten, matching Next's own precedence.
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const REQUIRED = [
  "TIGRIS_STORAGE_ENDPOINT",
  "TIGRIS_STORAGE_ACCESS_KEY_ID",
  "TIGRIS_STORAGE_SECRET_ACCESS_KEY",
];
const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
if (missing.length > 0) {
  console.error(`Missing ${missing.join(", ")}. Add them to .env or the environment.`);
  process.exit(1);
}

const endpoint = process.env.TIGRIS_STORAGE_ENDPOINT.replace(/\/+$/, "");
const BUCKET = process.env.TIGRIS_STORAGE_BUCKET || "artsfashion-media";
const wantPublic = process.env.TIGRIS_STORAGE_PUBLIC === "true";

const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
  },
});

const PROBE_KEY = "_tigris-setup/probe.txt";
const say = (label, value) => console.log(`  ${label.padEnd(34)} ${value}`);
const fail = (label, e) => console.log(`  ${label.padEnd(34)} FAILED  ${e?.name ?? ""}: ${e?.message ?? e}`);

console.log(`\nTigris setup`);
console.log(`  ${"endpoint".padEnd(34)} ${endpoint}`);
console.log(`  ${"bucket".padEnd(34)} ${BUCKET}`);
console.log(`  ${"requested public".padEnd(34)} ${wantPublic}\n`);

// 1. Who am I
try {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
  void r;
} catch {
  /* bucket may not exist yet; the real identity check is below */
}
try {
  const { ListBucketsCommand } = await import("@aws-sdk/client-s3");
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  say("account buckets", Buckets.length === 0 ? "none yet" : Buckets.map((b) => b.Name).join(", "));
} catch (e) {
  console.log(`  ${"account".padEnd(34)} could not list buckets: ${e?.name}`);
}

// 2. Does the bucket exist
let exists = true;
try {
  await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  say("bucket", "already exists");
} catch {
  exists = false;
}

if (!exists) {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    say("bucket", "created");
    exists = true;
  } catch (e) {
    if (/BucketAlreadyExists|not available/i.test(e?.message ?? "")) {
      console.error(
        `\n  The name "${BUCKET}" is taken in Tigris's global namespace, which is shared\n` +
          `  across every account. It is not yours and cannot be used. Choose another\n` +
          `  name in TIGRIS_STORAGE_BUCKET.\n`
      );
    } else {
      fail("bucket create", e);
    }
  }
}

if (!exists) process.exit(1);

// 3. Round-trip, so the keys are proven to work and not merely to authenticate
try {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: PROBE_KEY, Body: "ok", ContentType: "text/plain" }));
  say("write probe object", "ok");
  await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: PROBE_KEY }));
  say("read probe object", "ok");
} catch (e) {
  fail("write/read probe", e);
  process.exit(1);
}

// 4. Public read
const anonStatus = (await fetch(`${endpoint}/${BUCKET}/${PROBE_KEY}`)).status;
if (anonStatus === 200) {
  say("anonymous read", "200  bucket is public");
} else {
  say("anonymous read", `${anonStatus}  bucket is private`);
  if (wantPublic) {
    try {
      await s3.send(new PutBucketAclCommand({ Bucket: BUCKET, ACL: "public-read" }));
      say("set public-read", "ok");
    } catch (e) {
      if (/PaymentVerificationRequired/i.test(e?.message ?? "")) {
        console.log(
          `\n  The bucket cannot be made public yet, and that is expected.\n` +
            `  Tigris requires a verified payment method on the account before it will\n` +
            `  expose a bucket publicly:\n\n` +
            `      ${e.message}\n\n` +
            `  Until that is done, the app serves images through /api/media/<path>,\n` +
            `  which streams from Tigris with signed requests. That is the current\n` +
            `  setting and it works.\n\n` +
            `  To switch to direct Tigris URLs later:\n` +
            `      1. Verify a payment method in the Tigris dashboard.\n` +
            `      2. Set TIGRIS_STORAGE_PUBLIC=true.\n` +
            `      3. node scripts/tigris-setup.mjs   to confirm the anonymous read.\n` +
            `      4. Redeploy, so next.config.mjs picks up the host.\n`
        );
      } else {
        fail("set public-read", e);
      }
    }
  }
}

// 5. Housekeeping
if (process.argv.includes("--delete")) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: PROBE_KEY }));
    say("probe object removed", "ok");
  } catch (e) {
    fail("remove probe", e);
  }
} else {
  say("probe object", `left at ${PROBE_KEY} (--delete to remove)`);
}

console.log(`\nDone. The app reads the same variables, so it is configured too.`);
console.log(`Next step: node scripts/test-media-api.mjs to prove uploads end to end.\n`);
