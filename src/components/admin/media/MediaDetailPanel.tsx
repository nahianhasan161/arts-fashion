"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, Package, Star, Trash2, Unlink, X } from "lucide-react";
import type { MediaItem, MediaFolder } from "@/types";
import AltTextField from "./AltTextField";

/**
 * Right-hand inspector for one library item, in the style of the
 * WordPress media modal.
 *
 * The primary decision here is that an attached image offers Detach
 * rather than Delete. The delete guard refuses anything a product still
 * references, and the sync trigger guarantees every product image is
 * referenced, so offering Delete first would mean offering a button that
 * cannot work. Detach is the action that is actually available, and it is
 * reversible.
 */
export default function MediaDetailPanel({
  item,
  folders,
  products,
  onClose,
  onPatch,
  onDetach,
  onDelete,
  onAttach,
  busy,
}: {
  item: MediaItem;
  folders: MediaFolder[];
  products: { id: string; title: string }[];
  onClose: () => void;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDetach: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAttach: (id: string, productId: string) => Promise<void>;
  busy?: boolean;
}) {
  const [attachTo, setAttachTo] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attached = !item.unattached;
  const isPrimary = Boolean(item.is_primary);
  const inUse = attached;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  return (
    <aside className="w-full lg:w-80 shrink-0 bg-surface-card border-t lg:border-t-0 lg:border-l border-border-light flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
        <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
          File details
        </h3>
        <button type="button" onClick={onClose} aria-label="Close details">
          <X className="w-4 h-4 text-text-muted hover:text-on-surface" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="relative aspect-square rounded-lg overflow-hidden bg-surface-subtle border border-border-light">
          <Image
            src={item.url}
            alt={item.alt_text ?? ""}
            fill
            sizes="320px"
            className="object-contain"
            unoptimized
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-2.5 py-2 text-[11px] text-badge-discount">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
            File name
          </label>
          <input
            defaultValue={item.file_name}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== item.file_name) {
                void run(() => onPatch(item.id, { file_name: next }));
              }
            }}
            className="w-full px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Alt text
          </label>
          <AltTextField
            value={item.alt_text}
            onSave={(next) => void run(() => onPatch(item.id, { alt_text: next }))}
          />
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
            Folder
          </label>
          <select
            value={item.folder_id ?? ""}
            onChange={(e) =>
              void run(() =>
                onPatch(item.id, { folder_id: e.target.value || null })
              )
            }
            className="w-full px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Uncategorised</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <dl className="text-[11px] flex flex-col gap-1.5 bg-surface-subtle rounded-lg p-2.5">
          <div className="flex justify-between gap-2">
            <dt className="text-text-muted">Type</dt>
            <dd className="truncate">{item.mime_type}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-text-muted">Size</dt>
            <dd>{formatBytes(item.byte_size)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-text-muted">Status</dt>
            <dd>{attached ? "On a product" : "Awaiting attachment"}</dd>
          </div>
          {attached && item.product_id && (
            <div className="flex justify-between gap-2">
              <dt className="text-text-muted">Product</dt>
              <dd className="truncate">
                <Link
                  href={`/admin/products?edit=${item.product_id}`}
                  className="text-primary hover:underline truncate inline-flex items-center gap-1"
                >
                  <Package className="w-3 h-3 shrink-0" />
                  {item.product_id}
                </Link>
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-text-muted">Path</dt>
            <dd className="truncate" title={item.storage_path}>
              {item.storage_path}
            </dd>
          </div>
        </dl>

        {isPrimary && (
          <p className="flex items-center gap-1.5 text-[10px] text-primary">
            <Star className="w-3 h-3" /> Primary image for its product
          </p>
        )}
      </div>

      <div className="border-t border-border-light p-3 flex flex-col gap-2">
        {attached ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onDetach(item.id))}
              className="flex items-center justify-center gap-1.5 px-3 py-2 border border-border-light rounded-lg text-[10px] font-bold uppercase tracking-wider text-on-surface hover:bg-surface-subtle disabled:opacity-50"
            >
              <Unlink className="w-3.5 h-3.5" /> Remove from product
            </button>
            <p className="text-[10px] text-text-muted">
              {inUse
                ? "In use by a live product page, so it cannot be deleted outright. Removing it from the product makes it deletable and is reversible."
                : ""}
            </p>
          </>
        ) : (
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
              Attach to product
            </label>
            <select
              value={attachTo}
              onChange={(e) => setAttachTo(e.target.value)}
              className="w-full px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Choose a product...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!attachTo || busy}
              onClick={() => {
                void run(async () => {
                  await onAttach(item.id, attachTo);
                  setAttachTo("");
                });
              }}
              className="mt-1.5 w-full px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              Attach
            </button>
          </div>
        )}

        {/* Only offered for files no product references, so the button is
            never one that cannot succeed. */}
        {!inUse &&
          (showDelete ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                className="flex-1 px-3 py-2 border border-border-light rounded-lg text-[10px] font-bold uppercase tracking-wider text-text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onDelete(item.id))}
                className="flex-1 px-3 py-2 bg-badge-discount text-white rounded-lg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Delete for good
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-badge-discount hover:underline"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete file
            </button>
          ))}
      </div>
    </aside>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
