"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  Grid3x3,
  List,
  Loader2,
  Search,
  Star,
  X,
} from "lucide-react";
import type {
  MediaFilters,
  MediaFolder,
  MediaItem,
  MediaPage,
  MediaSort,
  MediaStats,
} from "@/types";
import StorageAnalytics from "./StorageAnalytics";
import MediaDetailPanel from "./MediaDetailPanel";
import UploadDropzone from "./UploadDropzone";

/**
 * Cross-product media library.
 *
 * Reads through /api/admin/media, which is a view over product_images
 * plus the staged uploads, so nothing here holds its own copy of the
 * truth. Every mutation goes to the server and the affected row is
 * replaced from the response rather than patched locally, because the
 * database rebuilds the products.images projection as a side effect and
 * a local guess about the new state would eventually disagree with it.
 */

const DEFAULT_FILTERS: MediaFilters = {
  search: "",
  mime: "",
  folder: "",
  missingAlt: false,
  sort: "newest",
  offset: 0,
  limit: 60,
};

export default function MediaLibrary() {
  const [filters, setFilters] = useState<MediaFilters>(DEFAULT_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState<MediaPage>({ items: [], total: 0, limit: 60, offset: 0 });
  const [staged, setStaged] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [products, setProducts] = useState<{ id: string; title: string }[]>([]);
  const [stats, setStats] = useState<MediaStats | null>(null);

  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [newFolder, setNewFolder] = useState("");
  const [uploading, setUploading] = useState(0);

  const requestId = useRef(0);

  const query = useCallback(
    (f: MediaFilters) => {
      const p = new URLSearchParams();
      if (f.search) p.set("search", f.search);
      if (f.mime) p.set("mime", f.mime);
      if (f.folder) p.set("folder", f.folder);
      if (f.missingAlt) p.set("missing_alt", "true");
      p.set("sort", f.sort);
      p.set("limit", String(f.limit));
      p.set("offset", String(f.offset));
      return p.toString();
    },
    []
  );

  const load = useCallback(async () => {
    // Guards against an older response overwriting a newer one when the
    // admin types quickly into the search box.
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media?${query(filters)}`, { cache: "no-store" });
      const json = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) throw new Error(json.error ?? "Could not load the library");
      setPage(json as MediaPage);
    } catch (e) {
      if (id === requestId.current) {
        setError(e instanceof Error ? e.message : "Could not load the library");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [filters, query]);

  const loadSide = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [statsRes, foldersRes, productsRes] = await Promise.all([
        fetch("/api/admin/media/stats", { cache: "no-store" }),
        fetch("/api/admin/media/folders", { cache: "no-store" }),
        fetch("/api/admin/products", { cache: "no-store" }),
      ]);
      if (statsRes.ok) setStats((await statsRes.json()) as MediaStats);
      if (foldersRes.ok) {
        const f = await foldersRes.json();
        setFolders(f.folders ?? []);
        setStaged(f.staged ?? []);
      }
      if (productsRes.ok) {
        const p = await productsRes.json();
        const rows = Array.isArray(p) ? p : (p.data ?? p.products ?? []);
        setProducts(
          rows
            .filter((r: { id?: string }) => Boolean(r?.id))
            .map((r: { id: string; title: string }) => ({ id: r.id, title: r.title }))
        );
      }
    } catch {
      // The side panels are supporting detail, so a failure here must not
      // take the grid down with it.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadSide();
  }, [loadSide]);

  // Debounced so each keystroke does not become a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) =>
        f.search === searchDraft ? f : { ...f, search: searchDraft, offset: 0 }
      );
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const setFilter = (patch: Partial<MediaFilters>) =>
    setFilters((f) => ({ ...f, ...patch, offset: patch.offset ?? 0 }));

  const reloadAll = async () => {
    await Promise.all([load(), loadSide()]);
  };

  const patchItem = async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/media/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not update the file");
    // Replace the row from the server rather than patching it locally.
    if (json.item) {
      setPage((p) => ({
        ...p,
        items: p.items.map((i) => (i.id === id ? { ...i, ...json.item } : i)),
      }));
      setSelected((s) => (s && s.id === id ? { ...s, ...json.item } : s));
    }
    void loadSide();
  };

  const patchStaged = async (id: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/media/attachments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not update the file");
    if (json.item) {
      setStaged((s) => s.map((i) => (i.id === id ? { ...i, ...json.item } : i)));
      setSelected((sel) => (sel && sel.id === id ? { ...sel, ...json.item } : sel));
    }
    void loadSide();
  };

  const detach = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media/${id}/detach`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not remove the file from its product");
      setNotice("Removed from the product. The file is now awaiting attachment.");
      setSelected(null);
      await reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.hint ? `${json.error}. ${json.hint}` : (json.error ?? "Delete failed"));
      }
      if (json.storage_warning) {
        setNotice(`Deleted, but the file could not be removed from storage: ${json.storage_warning}`);
      }
      setSelected(null);
      await reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const attach = async (id: string, productId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media/${id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not attach the file");
      setSelected(null);
      await reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(files.length);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/admin/media", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      if (json.failed?.length) {
        setError(
          `${json.failed.length} file${json.failed.length === 1 ? "" : "s"} rejected: ` +
            json.failed.map((f: { name: string; reason: string }) => f.reason).join("; ")
        );
      } else {
        setNotice(`${json.uploaded} file${json.uploaded === 1 ? "" : "s"} uploaded.`);
      }
      await reloadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(0);
    }
  };

  const addFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/admin/media/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Could not create the folder");
      setNewFolder("");
      void loadSide();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the folder");
    }
  };

  const deleteStaged = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/media/attachments/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not delete the file");
      if (json.storage_warning) {
        setNotice(`Deleted, but the file could not be removed from storage: ${json.storage_warning}`);
      }
      setSelected(null);
      await reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const total = page.total;
  const shown = page.items.length;
  const pageStart = total === 0 ? 0 : page.offset + 1;
  const pageEnd = page.offset + shown;
  const canPage = pageEnd < total;

  const allItems: MediaItem[] = [...page.items, ...staged];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-primary">Media library</h1>
          <p className="text-[11px] text-text-muted mt-0.5">
            Every image across all products. Files attached to a product are part of that
            product&rsquo;s page, so they are removed from the product before they can be deleted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAnalytics((s) => !s)}
          className="text-[10px] font-bold uppercase tracking-wider text-text-muted hover:text-primary shrink-0"
        >
          {showAnalytics ? "Hide" : "Show"} figures
        </button>
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

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[11px] text-primary">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {showAnalytics && <StorageAnalytics stats={stats} loading={statsLoading} onFilterMissingAlt={() => setFilter({ missingAlt: true })} />}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search by file name or alt text"
            aria-label="Search media"
            className="w-full pl-8 pr-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <select
          value={filters.mime}
          onChange={(e) => setFilter({ mime: e.target.value })}
          aria-label="Filter by type"
          className="px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All types</option>
          {(stats ? Object.keys(stats.by_mime) : ["image/jpeg", "image/png", "image/webp", "image/avif"]).map((m) => (
            <option key={m} value={m}>
              {m.replace("image/", "").toUpperCase()}
            </option>
          ))}
        </select>

        <select
          value={filters.folder}
          onChange={(e) => setFilter({ folder: e.target.value })}
          aria-label="Filter by folder"
          className="px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>

        <select
          value={filters.sort}
          onChange={(e) => setFilter({ sort: e.target.value as MediaSort })}
          aria-label="Sort"
          className="px-2 py-1.5 text-[11px] border border-border-light rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name</option>
          <option value="size">Largest</option>
        </select>

        <button
          type="button"
          onClick={() => setFilter({ missingAlt: !filters.missingAlt })}
          className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border ${
            filters.missingAlt
              ? "border-badge-discount bg-badge-discount/10 text-badge-discount"
              : "border-border-light text-text-muted hover:text-on-surface"
          }`}
        >
          Missing alt
        </button>

        <div className="flex border border-border-light rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setView("grid")}
            aria-label="Grid view"
            className={`px-2 py-1.5 ${view === "grid" ? "bg-primary text-white" : "text-text-muted"}`}
          >
            <Grid3x3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label="List view"
            className={`px-2 py-1.5 ${view === "list" ? "bg-primary text-white" : "text-text-muted"}`}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Folders */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
          <Folder className="w-3.5 h-3.5" /> Folders
        </div>
        <button
          type="button"
          onClick={() => setFilter({ folder: "" })}
          className={`px-2 py-0.5 rounded text-[10px] ${
            filters.folder === "" ? "bg-primary text-white" : "bg-surface-subtle text-text-muted"
          }`}
        >
          All
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter({ folder: filters.folder === f.id ? "" : f.id })}
            className={`px-2 py-0.5 rounded text-[10px] ${
              filters.folder === f.id
                ? "bg-primary text-white"
                : "bg-surface-subtle text-text-muted hover:text-on-surface"
            }`}
          >
            {f.name}
          </button>
        ))}
        <span className="flex items-center gap-1 ml-1">
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addFolder();
            }}
            placeholder="New folder"
            aria-label="New folder name"
            className="w-28 px-2 py-0.5 text-[10px] border border-border-light rounded bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void addFolder()}
            aria-label="Create folder"
            className="p-1 rounded bg-surface-subtle text-text-muted hover:text-primary"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      {uploading > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading {uploading} file
          {uploading === 1 ? "" : "s"}...
        </div>
      )}

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading library...
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[11px] text-text-muted">
                {total === 0 && staged.length === 0
                  ? "No media yet. Upload something below, or add images from a product."
                  : "Nothing matches these filters."}
              </p>
              <div className="w-full max-w-sm">
                <UploadDropzone onFiles={(f) => void upload(f)} compact />
              </div>
            </div>
          ) : (
            <>
              {view === "grid" ? (
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {page.items.map((item) => (
                    <li key={item.id}>
                      <MediaCard
                        item={item}
                        selected={selected?.id === item.id}
                        onSelect={() => setSelected(item)}
                      />
                    </li>
                  ))}
                  {staged.map((item) => (
                    <li key={item.id}>
                      <MediaCard
                        item={item}
                        selected={selected?.id === item.id}
                        onSelect={() => setSelected(item)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="flex flex-col divide-y divide-border-light border border-border-light rounded-lg overflow-hidden">
                  {allItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-subtle ${
                          selected?.id === item.id ? "bg-surface-subtle" : ""
                        }`}
                      >
                        <div className="relative w-10 h-10 rounded overflow-hidden bg-surface-subtle shrink-0">
                          <Image
                            src={item.url}
                            alt=""
                            fill
                            sizes="40px"
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] text-on-surface truncate">
                            {item.file_name}
                          </span>
                          <span className="block text-[10px] text-text-muted truncate">
                            {item.alt_text || "No alt text"}
                          </span>
                        </span>
                        {!item.alt_text && (
                          <span className="text-[9px] text-badge-discount shrink-0">no alt</span>
                        )}
                        {item.unattached ? (
                          <span className="text-[9px] text-text-muted shrink-0">staged</span>
                        ) : item.is_primary ? (
                          <Star className="w-3 h-3 text-primary shrink-0" />
                        ) : null}
                        <span className="text-[10px] text-text-muted w-14 text-right shrink-0">
                          {formatBytes(item.byte_size)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {total > page.limit && (
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <span>
                    Showing {pageStart}&ndash;{pageEnd} of {total}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      disabled={page.offset === 0}
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          offset: Math.max(0, f.offset - f.limit),
                        }))
                      }
                      className="px-2 py-1 border border-border-light rounded disabled:opacity-40"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={!canPage}
                      onClick={() =>
                        setFilters((f) => ({ ...f, offset: f.offset + f.limit }))
                      }
                      className="px-2 py-1 border border-border-light rounded disabled:opacity-40"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </span>
                </div>
              )}
            </>
          )}

          {(page.items.length > 0 || staged.length > 0) && (
            <UploadDropzone onFiles={(f) => void upload(f)} compact hint="" />
          )}
        </div>

        {selected && (
          <MediaDetailPanel
            item={selected}
            folders={folders}
            products={products}
            busy={busy}
            onClose={() => setSelected(null)}
            onPatch={async (id, p) => {
              if (selected.unattached) await patchStaged(id, p);
              else await patchItem(id, p);
            }}
            onDetach={async (id) => detach(id)}
            onDelete={async (id) => {
              if (selected.unattached) await deleteStaged(id);
              else await remove(id);
            }}
            onAttach={attach}
          />
        )}
      </div>
    </div>
  );
}

function MediaCard({
  item,
  selected,
  onSelect,
}: {
  item: MediaItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border overflow-hidden bg-surface-card transition-colors ${
        selected ? "border-primary" : "border-border-light hover:border-primary/50"
      }`}
    >
      <div className="relative aspect-square bg-surface-subtle">
        <Image
          src={item.url}
          alt={item.alt_text ?? ""}
          fill
          sizes="200px"
          className="object-cover"
          unoptimized
        />
        {item.is_primary && (
          <span className="absolute top-1 left-1 bg-primary text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
            Primary
          </span>
        )}
        {item.unattached && (
          <span className="absolute top-1 right-1 bg-badge-discount text-white text-[9px] font-bold uppercase px-1.5 py-0.5 rounded">
            Staged
          </span>
        )}
      </div>
      <div className="p-1.5">
        <p className="text-[10px] text-on-surface truncate">{item.file_name}</p>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[9px] text-text-muted">{formatBytes(item.byte_size)}</span>
          {item.alt_text ? (
            <span className="text-[9px] text-primary">alt set</span>
          ) : (
            <span className="text-[9px] text-badge-discount">no alt</span>
          )}
        </div>
      </div>
    </button>
  );
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
