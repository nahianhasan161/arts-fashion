import "server-only";

/**
 * Object storage, on Tigris.
 *
 * Tigris is S3-compatible, so this speaks the S3 API through @aws-sdk/client-s3
 * against the account's global endpoint. Credentials come from the environment
 * and are never exposed: this module is server-only, so the secret access key
 * cannot reach a client bundle even if something imports it by mistake.
 *
 * ## Why the public URL is behind a flag
 *
 * A storefront image has to be readable by a browser with no credentials.
 * Making a Tigris bucket public requires a verified payment method, and until
 * that is done an anonymous GET of a public-path URL answers 403. Rather than
 * leaving the shop broken until an account is configured, the shape of the
 * stored URL is decided by one flag:
 *
 *   TIGRIS_STORAGE_PUBLIC=true   -> https://<endpoint>/<bucket>/<path>
 *                                   served by Tigris, no app bandwidth, CDN
 *                                   cacheable, and what you want in production.
 *
 *   TIGRIS_STORAGE_PUBLIC=false  -> /api/media/<path>
 *                                   streamed by this app from Tigris with
 *                                   signed requests. Works today with no
 *                                   account changes.
 *
 * Both are the same string in the `url` column, and both are resolved by
 * publicUrlFor(), so no caller changes when the flag flips. next/image runs its
 * optimiser in this app either way, so the proxy path costs one extra hop for
 * the optimiser only -- browsers still never talk to Tigris directly.
 *
 * ## Bucket naming
 *
 * Tigris shares one global namespace across every account on the platform, so a
 * name that reads as obvious, like `product-images`, is frequently already
 * taken by an unrelated account and cannot be created. `artsfashion-media` is
 * this account's.
 */

import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";

export const BUCKET = process.env.TIGRIS_STORAGE_BUCKET ?? "artsfashion-media";

/**
 * Extensions the app will ever store, as decided by sniffImage().
 *
 * The object path is generated server-side, so this is not a security control
 * on upload. It is the allow-list the read route enforces, because that route
 * is anonymous and must never be turned into a general-purpose reader for
 * whatever else lands in the bucket.
 */
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Object storage is not configured; missing ${missing.join(", ")}`);
    this.name = "StorageNotConfiguredError";
  }
}

let cached: S3Client | null = null;

/**
 * The names of the required environment variables that are absent or empty.
 *
 * Returned rather than thrown from a single place so the setup script, the
 * read route and the write routes can all report the same list. A missing key
 * that quietly becomes an unsigned or wrong-signed request would surface as a
 * 403 from the provider with nothing useful in the logs.
 */
export function missingStorageConfig(): string[] {
  const required = [
    "TIGRIS_STORAGE_ENDPOINT",
    "TIGRIS_STORAGE_ACCESS_KEY_ID",
    "TIGRIS_STORAGE_SECRET_ACCESS_KEY",
  ];
  return required.filter((name) => {
    const v = process.env[name];
    return typeof v !== "string" || v.trim() === "";
  });
}

export function isStorageConfigured(): boolean {
  return missingStorageConfig().length === 0;
}

/**
 * The S3 client, built once per process.
 *
 * `region: "auto"` is what Tigris expects and is not a real region. The
 * endpoint is the account's global host, so a bucket is addressed in virtual
 * hosted style -- `artsfashion-media.t3.storage.dev` -- which is the SDK
 * default and is what makes the public URL of the same shape work.
 */
export function tigrisClient(): S3Client {
  if (cached) return cached;

  const missing = missingStorageConfig();
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);

  cached = new S3Client({
    region: "auto",
    endpoint: endpoint(),
    credentials: {
      accessKeyId: process.env.TIGRIS_STORAGE_ACCESS_KEY_ID!,
      secretAccessKey: process.env.TIGRIS_STORAGE_SECRET_ACCESS_KEY!,
    },
  });
  return cached;
}

export function endpoint(): string {
  return (process.env.TIGRIS_STORAGE_ENDPOINT ?? "").replace(/\/+$/, "");
}

/**
 * Whether objects are served by Tigris directly.
 *
 * Unset means false, so a deployment that forgets the flag gets the working
 * proxy path rather than a pile of 403s from anonymous reads.
 */
export function isPublicBucket(): boolean {
  return process.env.TIGRIS_STORAGE_PUBLIC === "true";
}

/** The route that streams an object when the bucket is not public. */
const PROXY_PREFIX = "/api/media";

export function publicUrlFor(path: string): string {
  return isPublicBucket() ? `${endpoint()}/${BUCKET}/${encodePath(path)}` : `${PROXY_PREFIX}/${path}`;
}

/**
 * Percent-encodes each path segment while leaving the separators alone.
 *
 * encodeURIComponent on the whole path would turn every "/" into %2F, which
 * changes the object's key. Segments are encoded individually so a file name
 * with a space or a "#" resolves to the same key it was stored under.
 */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Whether a path is one this app is allowed to read.
 *
 * The read route is anonymous, so this is the only thing standing between a
 * crafted URL and every object in the bucket. Two rules:
 *
 *   - The shape is `<folder>/<uuid>.<ext>`, which is what uploadMediaFile()
 *     generates. A real path has exactly one folder and one dot.
 *   - `unattached/` is refused. Staged uploads are not attached to a product
 *     yet, so publishing them would expose a file the library has not finished
 *     with and that no product references.
 */
export function isReadablePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) return false;
  // A traversal attempt is refused outright rather than normalised. A path
  // that needed normalising is a path that was not generated here.
  if (path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/");
  if (parts.length !== 2) return false;
  const [folder, file] = parts;
  // `unattached` is a well-formed folder name, so it has to be refused by name
  // rather than by shape. Staged uploads are not attached to a product yet.
  if (folder === "unattached") return false;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(folder)) return false;
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  return /^[A-Za-z0-9-]+\.[A-Za-z0-9]+$/.test(file);
}

export type PutResult = { ok: true } | { ok: false; message: string };

/**
 * Stores one object.
 *
 * There is no upsert option on purpose. Every generated path contains a fresh
 * uuid, so an existing key at that path means the uuid collided rather than
 * that an admin is replacing a file, and overwriting a live product's image
 * would be worse than failing the upload and reporting it.
 */
export async function putObject(
  path: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
): Promise<PutResult> {
  try {
    await tigrisClient().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: path,
        Body: body,
        ContentType: contentType,
        // Object paths are uuid-based and never reused, so the bytes at a
        // given path never change. A one-year immutable cache is therefore
        // correct and is what keeps the storefront off the origin.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

/**
 * Deletes objects, reporting rather than throwing.
 *
 * Callers delete the database row first, so a failure here leaves an
 * unreferenced file, which is recoverable, rather than a row pointing at a
 * missing object, which is a broken image on a live product page.
 *
 * DeleteObjects takes at most 1000 keys, so the list is chunked. S3 caps a
 * single delete request; sending more in one call fails the whole batch and
 * would leave every file in the overflow behind.
 */
export async function deleteObjects(paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const client = tigrisClient();
  const errors: string[] = [];

  for (let i = 0; i < paths.length; i += 1000) {
    const chunk = paths.slice(i, i + 1000);
    try {
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      // With Quiet, failures come back in Errors rather than as a thrown
      // error, so a partial delete has to be read off the result.
      for (const err of result.Errors ?? []) {
        errors.push(`${err.Key}: ${err.Code ?? "unknown"}`);
      }
    } catch (error) {
      return errorMessage(error);
    }
  }

  return errors.length > 0 ? `Some objects were not removed: ${errors.slice(0, 5).join("; ")}` : null;
}

/**
 * Copies an object within the bucket.
 *
 * This is how a staged upload becomes a product image: the file moves from
 * `unattached/<uuid>.png` to `<productId>/<uuid>.png`, and the copy runs before
 * the row is re-pointed so that a failure at any later step leaves a file that
 * is genuinely there under the name the row still holds. The caller deletes the
 * old key only once the row has moved, which is the point at which it becomes
 * unreferenced.
 *
 * S3 has no rename, so this is a server-side copy followed by the caller's
 * delete. At Tigris the copy is metadata-only, so nothing is re-transferred.
 */
export async function copyObject(fromPath: string, toPath: string): Promise<string | null> {
  try {
    await tigrisClient().send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: toPath,
        // CopySource is a single "bucket/key" string, not a bucket and a key
        // as separate fields, and the key has to be percent-encoded. Without
        // the encoding a path containing a space is silently sent as a
        // different key, and the copy appears to have succeeded while writing
        // an object nothing will ever read.
        CopySource: encodeURIComponent(`${BUCKET}/${fromPath}`),
        // Carried over so the copy is served exactly like the original.
        MetadataDirective: "COPY",
      }),
    );
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

export interface FetchedObject {
  body: Readable;
  contentType: string | null;
  contentLength: number | null;
  etag: string | null;
}

/**
 * Reads one object for streaming.
 *
 * Returns null when the object does not exist, so the caller can answer 404
 * rather than surfacing a provider error as a 500. A missing object is an
 * expected state here: a row can outlive its file if a previous delete failed,
 * and the read route has to render that as a broken image, not a server fault.
 */
export async function getObjectStream(path: string): Promise<FetchedObject | null> {
  try {
    const result = await tigrisClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: path }));
    return {
      body: result.Body as Readable,
      contentType: result.ContentType ?? null,
      contentLength: result.ContentLength ?? null,
      etag: result.ETag ?? null,
    };
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "NoSuchKey" || name === "NotFound") return null;
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** True when the object is absent. */
export async function objectExists(path: string): Promise<boolean> {
  try {
    await tigrisClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: path, Range: "bytes=0-0" }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NoSuchKey") return false;
    throw error;
  }
}

function errorMessage(error: unknown): string {
  const e = error as { message?: string; name?: string };
  // A provider error names itself, which is what makes it diagnosable in a
  // log. The raw message is returned rather than a generic sentence so the
  // cause -- AccessDenied, PaymentVerificationRequired, a missing bucket -- is
  // visible in the route response the admin sees.
  return e?.message ? `${e.name ?? "StorageError"}: ${e.message}` : "Object storage request failed";
}
