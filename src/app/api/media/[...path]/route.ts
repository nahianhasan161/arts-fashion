import { NextResponse } from "next/server";
import { getObjectStream, isReadablePath, isStorageConfigured, missingStorageConfig, BUCKET } from "@/lib/media/storage";

/**
 * Streams one media object to the browser.
 *
 * This exists only while the Tigris bucket is private. Tigris refuses to make a
 * bucket public until a payment method is verified, so an anonymous GET of the
 * direct object URL answers 403. Once the bucket is public, set
 * TIGRIS_STORAGE_PUBLIC=true and publicUrlFor() stops returning paths that come
 * here -- at which point this route serves nothing and can be deleted.
 *
 * ## Why it is safe to leave anonymous
 *
 * The route is unauthenticated, so it must not be a general reader for the
 * bucket. Three things keep it narrow:
 *
 *   - isReadablePath() allows exactly the shape uploadMediaFile() generates,
 *     one folder and one uuid-named image, so a crafted path cannot walk out
 *     of that shape or reach a staged `unattached/` upload.
 *   - Object keys are uuid-based, so a key is not guessable and the response
 *     is not enumerable even by someone who knows a product id.
 *   - Only the five image extensions sniffImage() accepts are served, so this
 *     cannot be used to fetch a document or an executable that happens to be
 *     in the same bucket.
 *
 * The database is deliberately not consulted. A product image has to render
 * even if the row that records it is missing or unreadable, because a broken
 * row should produce a broken image, not a 500 across the storefront.
 */

export const runtime = "nodejs";

/**
 * A streaming body needs a real stream, not the edge runtime, so this route is
 * pinned to Node. It is also a good fit: the credential read here must never be
 * inlined into edge middleware.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { path: string[] } },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: `Object storage is not configured; missing ${missingStorageConfig().join(", ")}` },
      { status: 503 },
    );
  }

  // Next gives the unmatched segments as an array; rejoining them is safe
  // only because isReadablePath() below rejects anything that is not exactly
  // two segments. This is a convenience for the common shape, not the check.
  const path = (params.path ?? []).join("/");

  if (!isReadablePath(path)) {
    return NextResponse.json({ error: "Not a readable media path" }, { status: 400 });
  }

  let object: Awaited<ReturnType<typeof getObjectStream>>;
  try {
    object = await getObjectStream(path);
  } catch (error) {
    // The provider failed, which is a fault on our side of the wire. The
    // detail goes to the log; the shopper gets a plain 502 and a retry.
    console.error(`[media] read failed for ${path} in ${BUCKET}:`, error);
    return NextResponse.json({ error: "Media is temporarily unavailable" }, { status: 502 });
  }

  if (!object) {
    // A row can outlive its file when a previous delete failed. That is a
    // missing object, not a server fault, and the product page should show a
    // placeholder rather than an error page.
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const body = object.body as unknown as ReadableStream<Uint8Array>;

  return new NextResponse(
    // A File or a web ReadableStream from the SDK; Node's response accepts the
    // web stream directly, which avoids buffering a 5MB image in memory.
    body as unknown as BodyInit,
    {
      status: 200,
      headers: {
        "Content-Type": object.contentType ?? "application/octet-stream",
        // Object paths are uuid-based and never reused, so the bytes at a path
        // never change. The immutable cache is what lets the browser and the
        // image optimiser stop asking.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        ...(object.contentLength !== null ? { "Content-Length": String(object.contentLength) } : {}),
        ...(object.etag ? { ETag: object.etag } : {}),
      },
    },
  );
}
