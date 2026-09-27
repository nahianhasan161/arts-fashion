import type { SupabaseClient } from "@supabase/supabase-js";
import { sniffImage, MAX_MEDIA_BYTES } from "./validate";

/**
 * Shared upload path for product media.
 *
 * Both the product editor and the media library upload through this, so
 * there is one definition of what an acceptable file is and one
 * compensation rule. Duplicating the upload block per surface is how the
 * two drift and a file ends up stored in a shape one of them cannot read.
 */

export const BUCKET = "product-images";

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
 * contain separators, collide, or carry an extension that disagrees with
 * the bytes.
 */
export async function uploadMediaFile(
  supabase: SupabaseClient,
  file: File,
  prefix: string
): Promise<UploadOutcome> {
  const name = file.name || "upload";

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

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, file, { contentType: sniff.mime, upsert: false });

  if (error) {
    return { ok: false, name, reason: error.message };
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
 * Removes an object, reporting rather than throwing.
 *
 * The database row is always the authority and is deleted first, so a
 * failure here leaves an unreferenced file, which is recoverable, instead
 * of a row pointing at a missing object, which is a broken image on a live
 * product page.
 */
export async function removeMediaObjects(
  supabase: SupabaseClient,
  paths: string[]
): Promise<string | null> {
  if (paths.length === 0) return null;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  return error ? error.message : null;
}

export function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "") + "/storage/v1/object/public"
  );
}

export function publicUrlFor(path: string): string {
  return `${publicBaseUrl()}/${BUCKET}/${path}`;
}
