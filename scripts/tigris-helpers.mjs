/**
 * Tigris access for the test scripts.
 *
 * The media suites used to assert against Supabase's storage.objects table and
 * remove leftovers through Supabase's Storage REST API. Objects now live in
 * Tigris, so both of those are replaced by real S3 calls against the same
 * bucket the app writes to.
 *
 * Deliberately a signed, credentialed client rather than an anonymous one. A
 * test that could only reach the bucket publicly would pass or fail on the
 * account's payment-verification state, which has nothing to do with whether
 * the media code is correct.
 */

import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

export const TIGRIS_BUCKET = process.env.TIGRIS_STORAGE_BUCKET || "artsfashion-media";
export const TIGRIS_ENDPOINT = (process.env.TIGRIS_STORAGE_ENDPOINT || "").replace(/\/+$/, "");
export const TIGRIS_PUBLIC = process.env.TIGRIS_STORAGE_PUBLIC === "true";

export function tigrisReady() {
  return Boolean(
    process.env.TIGRIS_STORAGE_ENDPOINT &&
      process.env.TIGRIS_STORAGE_ACCESS_KEY_ID &&
      process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
  );
}

function client() {
  if (!tigrisReady()) throw new Error("Tigris credentials are missing from the environment");
  return new S3Client({
    region: "auto",
    endpoint: TIGRIS_ENDPOINT,
    credentials: {
      accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY,
    },
  });
}

/** True when an object key is present. */
export async function objectExists(key) {
  try {
    await client().send(
      new ListObjectsV2Command({ Bucket: TIGRIS_BUCKET, Prefix: key, MaxKeys: 1 }),
    );
    const r = await client().send(new ListObjectsV2Command({ Bucket: TIGRIS_BUCKET, Prefix: key, MaxKeys: 1 }));
    return (r.KeyCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Every object key in the bucket that starts with one of `prefixes`. */
export async function listKeys(prefixes) {
  const out = [];
  const s3 = client();
  for (const prefix of prefixes) {
    let token;
    do {
      const r = await s3.send(
        new ListObjectsV2Command({ Bucket: TIGRIS_BUCKET, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of r.Contents ?? []) out.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  }
  return out;
}

/** Removes keys, reporting the ones that could not be removed. */
export async function deleteKeys(keys) {
  if (keys.length === 0) return [];
  const failed = [];
  const s3 = client();
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const r = await s3.send(
      new DeleteObjectsCommand({
        Bucket: TIGRIS_BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
      }),
    );
    for (const e of r.Errors ?? []) failed.push(e.Key);
  }
  return failed;
}

/**
 * The URL shape publicUrlFor() produces, for asserting on without duplicating
 * the decision. In public mode it is a Tigris URL; otherwise it is the app's
 * own streaming route.
 */
export function expectedUrlPrefix() {
  return TIGRIS_PUBLIC
    ? `${TIGRIS_ENDPOINT}/${TIGRIS_BUCKET}/`
    : "/api/media/";
}
