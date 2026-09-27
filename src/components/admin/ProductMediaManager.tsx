"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  Trash2,
  Star,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import type { ProductImage } from "@/types";
import UploadDropzone from "./media/UploadDropzone";
import {
  MEDIA_ACCEPTED_TYPES,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_PER_PRODUCT,
} from "@/types";

interface PendingUpload {
  id: string;
  name: string;
  preview: string;
  progress: number;
  error?: string;
}

interface ProductMediaManagerProps {
  productId: string;
  /** Called whenever the saved set changes, so the parent can refresh. */
  onChange?: (images: ProductImage[]) => void;
}

export default function ProductMediaManager({
  productId,
  onChange,
}: ProductMediaManagerProps) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingAlt, setEditingAlt] = useState<string | null>(null);
  const [altDraft, setAltDraft] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/products/${productId}/media`);
      if (!res.ok) throw new Error("Could not load images");
      const json = await res.json();
      const next: ProductImage[] = json.data ?? [];
      setImages(next);
      onChange?.(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load images");
    } finally {
      setLoading(false);
    }
  }, [productId, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const atLimit = images.length + pending.length >= MEDIA_MAX_PER_PRODUCT;

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const room = MEDIA_MAX_PER_PRODUCT - images.length;
      if (room <= 0) {
        setError(`A product can have at most ${MEDIA_MAX_PER_PRODUCT} images`);
        return;
      }

      const accepted = files.slice(0, room);
      if (accepted.length < files.length) {
        setError(
          `Only ${room} more image${room === 1 ? "" : "s"} fit; ${files.length - room} skipped`
        );
      }

      // Pre-filter on the client so obvious mistakes never hit the network.
      // The server re-checks the file signature; this is only for feedback.
      const usable = accepted.filter((f) => {
        if (!(MEDIA_ACCEPTED_TYPES as readonly string[]).includes(f.type)) {
          return false;
        }
        return f.size <= MEDIA_MAX_BYTES;
      });

      if (usable.length === 0) {
        if (accepted.length > 0) {
          setError("Those files are not supported images under 5MB");
        }
        return;
      }

      const localIds = usable.map((f) => `${f.name}-${crypto.randomUUID()}`);
      setPending((p) => [
        ...p,
        ...usable.map((f, i) => ({
          id: localIds[i],
          name: f.name,
          preview: URL.createObjectURL(f),
          progress: 0,
        })),
      ]);

      const form = new FormData();
      for (const f of usable) form.append("files", f);

      // XHR rather than fetch: upload progress is the reason to choose it,
      // and fetch still has no portable progress event.
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/admin/products/${productId}/media`);

        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          // Every pending row belongs to this one upload, and only a
          // single upload is ever in flight, so they all move together.
          setPending((p) => p.map((u) => ({ ...u, progress: pct })));
        };

        xhr.onload = () => {
          const body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          if (xhr.status >= 200 && xhr.status < 300) {
            if (body.failed?.length) {
              setError(
                `${body.failed.length} file${body.failed.length === 1 ? "" : "s"} rejected: ` +
                  body.failed.map((f: { name: string; reason: string }) => f.reason).join("; ")
              );
            }
          } else {
            setError(body.error ?? "Upload failed");
            setPending((p) =>
              p.map((u) => ({ ...u, error: body.error ?? "Upload failed" }))
            );
          }
          resolve();
        };

        xhr.onerror = () => {
          setError("Upload failed. Please try again.");
          resolve();
        };

        xhr.send(form);
      });

      setPending([]);
      await load();
    },
    [images.length, load, productId]
  );

  const patch = async (body: Record<string, unknown>) => {
    setError(null);
    const res = await fetch(`/api/admin/products/${productId}/media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Could not update images");
      return;
    }
    const next: ProductImage[] = json.data ?? [];
    setImages(next);
    onChange?.(next);
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const order = images.map((i) => i.id);
    const [moved] = order.splice(index, 1);
    order.splice(target, 0, moved);
    await patch({ image_ids: order });
  };

  const removeOne = async (image: ProductImage) => {
    setSavingId(image.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/products/${productId}/media?image_id=${image.id}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not remove the image");
        return;
      }
      if (json.storage_warning) {
        setError(`Image removed, but the file could not be deleted: ${json.storage_warning}`);
      }
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const removeAll = async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/products/${productId}/media?all=true`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not remove the images");
        return;
      }
      if (json.storage_warning) {
        setError(`Images removed, but some files could not be deleted: ${json.storage_warning}`);
      }
      setConfirmAll(false);
      await load();
    } catch {
      setError("Could not remove the images");
    }
  };

  const saveAlt = async (image: ProductImage) => {
    const trimmed = altDraft.trim();
    if (trimmed === (image.alt_text ?? "")) {
      setEditingAlt(null);
      return;
    }
    await patch({ image_id: image.id, alt_text: trimmed || null });
    setEditingAlt(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold text-on-surface">
          Product images
        </label>
        <span className="text-[10px] text-text-muted">
          {images.length}/{MEDIA_MAX_PER_PRODUCT} &middot; JPEG, PNG, WebP, AVIF &middot; max 5MB
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2 text-[11px] text-badge-discount">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Drop zone. Shared with the media library so both surfaces accept
          and present the same files. */}
      <UploadDropzone
        onFiles={(f) => void uploadFiles(f)}
        disabled={atLimit}
        disabledLabel="Image limit reached"
      />

      {/* Uploads in flight */}
      {pending.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {pending.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-2 bg-surface-subtle rounded-lg px-2.5 py-2"
            >
              {/* Object URL of a local file, so plain img is correct here */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u.preview}
                alt=""
                className="w-8 h-8 object-cover rounded border border-border-light shrink-0"
              />
              <span className="text-[11px] truncate flex-1">{u.name}</span>
              {u.error ? (
                <span className="text-[10px] text-badge-discount">{u.error}</span>
              ) : (
                <span className="flex items-center gap-1.5 shrink-0">
                  <div className="w-20 h-1 bg-border-light rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${u.progress}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted w-8 text-right">
                    {u.progress}%
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Saved images */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading images...
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <ImagePlus className="w-5 h-5 text-text-muted" />
          <p className="text-[11px] text-text-muted">
            No images yet. The storefront shows a placeholder until you add one.
          </p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {images.map((image, index) => (
              <li
                key={image.id}
                className={`relative group rounded-lg border overflow-hidden bg-surface-subtle ${
                  image.is_primary ? "border-primary" : "border-border-light"
                }`}
              >
                <div className="relative aspect-square">
                  <Image
                    src={image.url}
                    alt={image.alt_text ?? ""}
                    fill
                    sizes="200px"
                    className="object-cover"
                    unoptimized
                  />
                </div>

                {image.is_primary && (
                  <span className="absolute top-1 left-1 bg-primary text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
                    Primary
                  </span>
                )}

                {/* Hover controls. Kept in the DOM (not hover-only) so they
                    are reachable by keyboard. */}
                <div className="absolute top-1 right-1 flex gap-1">
                  {!image.is_primary && (
                    <button
                      type="button"
                      onClick={() => patch({ set_primary: image.id })}
                      aria-label="Set as primary"
                      title="Set as primary"
                      className="p-1 rounded bg-black/60 text-white hover:bg-primary"
                    >
                      <Star className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeOne(image)}
                    disabled={savingId === image.id}
                    aria-label="Delete image"
                    title="Delete image"
                    className="p-1 rounded bg-black/60 text-white hover:bg-badge-discount disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="absolute bottom-0 inset-x-0 flex items-center justify-between bg-black/55 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Move earlier"
                    className="p-0.5 rounded text-white hover:bg-white/20 disabled:opacity-30"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[9px] text-white/90">{index + 1}</span>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === images.length - 1}
                    aria-label="Move later"
                    className="p-0.5 rounded text-white hover:bg-white/20 disabled:opacity-30"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Alt text */}
                <div className="p-1.5 border-t border-border-light bg-surface-card">
                  {editingAlt === image.id ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        value={altDraft}
                        onChange={(e) => setAltDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveAlt(image);
                          if (e.key === "Escape") setEditingAlt(null);
                        }}
                        placeholder="Describe the image"
                        aria-label="Alt text"
                        className="flex-1 min-w-0 px-1.5 py-1 text-[10px] border border-border-light rounded focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => saveAlt(image)}
                        aria-label="Save alt text"
                        className="px-1.5 text-[10px] font-bold text-primary"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAlt(image.id);
                        setAltDraft(image.alt_text ?? "");
                      }}
                      className="w-full text-left text-[10px] text-text-muted truncate hover:text-primary"
                    >
                      {image.alt_text || "Add alt text"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setConfirmAll(true)}
            className="self-start text-[11px] font-semibold text-badge-discount hover:underline"
          >
            Remove all images
          </button>
        </>
      )}

      {confirmAll && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface-card rounded-xl border border-border-light p-5 w-full max-w-sm">
            <h3 className="font-display text-xs uppercase tracking-wider font-bold text-primary">
              Remove all images?
            </h3>
            <p className="text-[11px] text-text-muted mt-2">
              {images.length} image{images.length === 1 ? "" : "s"} will be deleted from
              storage and unlinked from this product. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setConfirmAll(false)}
                className="px-3 py-2 border border-border-light rounded-lg text-[10px] font-bold uppercase tracking-wider text-text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={removeAll}
                className="px-3 py-2 bg-badge-discount text-white rounded-lg text-[10px] font-bold uppercase tracking-wider"
              >
                Remove all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
