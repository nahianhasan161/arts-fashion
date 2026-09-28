import { sniffImage, MAX_MEDIA_BYTES } from "./validate";
import { putObject, deleteObjects, copyObject, publicUrlFor, isStorageConfigured, BUCKET } from "./storage";

/**
 * Shared upload policy for product media.
 *
 * This file owns what an acceptable file is and how it is compensated when the
 * database write fails. It owns no transport: the bytes go to Tigris through
 * storage.ts. Both the product editor and the media library upload through
 * this, so there is one definition of an acceptable file and one compensation
 * rule; duplicating the upload block per surface is how the two drift and a
 * file ends up stored in a shape one of them cannot read.
 *
 * The bucket and the public URL are re-exported from storage.ts so that
 * callers which only need a name or a URL do not have to know which provider
 * is behind them.
 */

export { BUCKET, publicUrlFor };

/**
 * Moves an object from one key to another.
 *
 * Re-exported so the attach route does not have to know which provider is
 * behind the move. The row is the authority on naming, so this is called
 * between the row's re-point and the old key's deletion, never instead of
 * either.
 */
export async function moveMediaObject(_supabase: unknown, fromPath: string, toPath: string): Promise<string | null> {
  if (!isStorageConfigured()) return "Object storage is not configured on this server";
  return copyObject(fromPath, toPath);
}

export interface UploadedAsset {
  /** Object path inside the bucket, `<prefix>/<uuid>.<ext>`. */
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
}

export type UploadOutcome =
  | { ok: true; asset: UploadedAsset }
  | { ok: false; name: string; reason: string };

/**
 * Uploads one file and returns the metadata to record for it.
 *
 * `prefix` is the folder the object lands in, normally the product id. The
 * path is generated here and the client's filename is never reused: it can
 * contain separators, collide, or carry an extension that disagrees with the
 * bytes.
 *
 * `supabase` is still accepted but unused. It is the caller's database client
 * and the two have nothing to do with each other now that objects live in
 * Tigris; dropping the parameter would have meant editing four call sites for
 * no behavioural gain, and keeping it means the signature still reads as "this
 * is the media upload, you have a database client in hand". It is prefixed with
 * an underscore to say so, and is deliberately not threaded into storage.
 */
export async function uploadMediaFile(
  _supabase: unknown,
  file: File,
  prefix: string,
): Promise<UploadOutcome> {
  const name = file.name || "upload";

  if (!isStorageConfigured()) {
    return { ok: false, name, reason: "Object storage is not configured on this server" };
  }

  // Checked from the declared length so an oversized file is never
  // buffered, and the bucket's own limit is a backstop rather than the
  // first line of defence.
  if (file.size > MAX_MEDIA_BYTES) {
    return { ok: false, name, reason: `Larger than ${MAX_MEDIA_BYTES / 1024 / 1024}MB` };
  }

  // The browser's content type is a hint, not evidence, so the signature
  // decides what the file actually is and therefore what extension it gets.
  const sniff = sniffImage(await file.arrayBuffer());
  if (!sniff.ok || !sniff.mime || !sniff.ext) {
    return { ok: false, name, reason: sniff.reason ?? "Unsupported image" };
  }

  const storage_path = `${prefix}/${crypto.randomUUID()}.${sniff.ext}`;

  const stored = await putObject(storage_path, Buffer.from(await file.arrayBuffer()), sniff.mime);
  if (!stored.ok) {
    return { ok: false, name, reason: stored.message };
  }

  return {
    ok: true,
    asset: {
      storage_path,
      // The display name is the client's, sanitised: it is only ever shown
      // and searched, never used to build a path.
      file_name: name.replace(/[/\\]/g, "_").slice(0, 200),
      mime_type: sniff.mime,
      byte_size: file.size,
    },
  };
}

/**
 * Removes objects, reporting rather than throwing.
 *
 * The database row is always the authority and is deleted first, so a
 * failure here leaves an unreferenced file, which is recoverable, instead
 * of a row pointing at a missing object, which is a broken image on a live
 * product page.
 */
export async function removeMediaObjects(_supabase: unknown, paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  if (!isStorageConfigured()) return "Object storage is not configured on this server";
  return deleteObjects(paths);
}
