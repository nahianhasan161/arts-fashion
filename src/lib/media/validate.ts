/**
 * Image validation for product media.
 *
 * The browser-supplied MIME type is a hint, not evidence: a client can
 * declare `image/jpeg` for anything. The bucket also rejects disallowed
 * types, but only after the bytes have crossed the network, so the
 * obvious cases are rejected here and the signature check is what
 * actually decides.
 */

/** First bytes of each supported format. */
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  {
    mime: "image/jpeg",
    ext: "jpg",
    // SOI marker
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    ext: "png",
    // 89 50 4E 47 0D 0A 1A 0A
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: "image/webp",
    ext: "webp",
    // "RIFF" .... "WEBP"
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    // ISO-BMFF container: "....ftypavif"
    mime: "image/avif",
    ext: "avif",
    test: (b) =>
      b.length >= 12 &&
      b[4] === 0x66 &&
      b[5] === 0x74 &&
      b[6] === 0x79 &&
      b[7] === 0x70 &&
      b[8] === 0x61 &&
      b[9] === 0x76 &&
      b[10] === 0x69 &&
      b[11] === 0x66,
  },
];

export interface SniffResult {
  ok: boolean;
  mime?: string;
  ext?: string;
  reason?: string;
}

export function sniffImage(bytes: ArrayBuffer | Uint8Array): SniffResult {
  const b =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.slice(0, bytes.byteLength));

  if (b.length === 0) {
    return { ok: false, reason: "File is empty" };
  }

  for (const sig of SIGNATURES) {
    if (sig.test(b)) {
      return { ok: true, mime: sig.mime, ext: sig.ext };
    }
  }

  return {
    ok: false,
    reason: "File is not a supported image (allowed: JPEG, PNG, WebP, AVIF)",
  };
}

export const ACCEPTED_MIME_TYPES = SIGNATURES.map((s) => s.mime);

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
