import { NextResponse } from "next/server";
import { publicUrlFor } from "./upload";

/**
 * Row mapping and error translation shared by the media routes.
 *
 * These cannot live in a route.ts: Next only permits route handlers and a
 * fixed set of config exports there, so a shared helper in a route file
 * fails the build.
 */

export interface MediaRow {
  id: string;
  product_id: string;
  storage_path: string;
  url: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  folder_id: string | null;
  created_at?: string;
  in_use?: boolean;
}

/** Build the client-facing shape from a product_images row. */
export function toMediaImage(row: Record<string, unknown>): MediaRow {
  const path = String(row.storage_path ?? "");
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    storage_path: path,
    url: publicUrlFor(path),
    file_name: (row.file_name as string | null) ?? path.split("/").pop() ?? path,
    mime_type: (row.mime_type as string | null) ?? "unknown",
    byte_size: Number(row.byte_size ?? 0),
    alt_text: (row.alt_text as string | null) ?? null,
    sort_order: Number(row.sort_order ?? 0),
    is_primary: Boolean(row.is_primary),
    folder_id: (row.folder_id as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? undefined,
    in_use: row.in_use === undefined ? undefined : Boolean(row.in_use),
  };
}

/** Build the client-facing shape from a media_attachments row. */
export function toAttachment(row: Record<string, unknown>) {
  const path = String(row.storage_path ?? "");
  return {
    id: String(row.id),
    storage_path: path,
    url: publicUrlFor(path),
    file_name: (row.file_name as string | null) ?? path.split("/").pop() ?? path,
    mime_type: (row.mime_type as string | null) ?? "unknown",
    byte_size: Number(row.byte_size ?? 0),
    alt_text: (row.alt_text as string | null) ?? null,
    folder_id: (row.folder_id as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? undefined,
    unattached: true,
  };
}

/** Map an RPC's raised word onto an HTTP status. */
export function mediaErrorResponse(message: string): NextResponse {
  const map: Record<string, number> = {
    admin_required: 403,
    product_not_found: 404,
    image_not_found: 404,
    attachment_not_found: 404,
    folder_not_found: 404,
    parent_folder_not_found: 404,
    folder_name_required: 400,
    invalid_storage_path: 400,
    invalid_mime_type: 400,
    invalid_byte_size: 400,
    image_limit_reached: 409,
    media_in_use: 409,
    media_already_attached: 409,
  };
  return NextResponse.json({ error: message }, { status: map[message] ?? 400 });
}

/** Strip the raised word out of a Postgres message for the UI. */
export function errorDetail(message: string): string {
  // No /s flag: the target is es2017, and the detail is the first line.
  const m = message.match(/^([a-z_]+):([^\n]*)/);
  return m ? m[2].trim() : message;
}
