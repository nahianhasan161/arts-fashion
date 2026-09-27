"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import type { MediaStats } from "@/types";

/**
 * Storage analytics for the library.
 *
 * The panel leads with alt-text coverage rather than total bytes, because
 * bytes are trivia and missing alt text is the actual accessibility and
 * SEO debt. Total storage is still shown, clearly labelled as the sum of
 * recorded file sizes.
 */

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="bg-surface-subtle rounded-lg px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p
        className={`text-base font-display font-bold mt-0.5 ${
          tone === "warn" ? "text-badge-discount" : "text-on-surface"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

export default function StorageAnalytics({
  stats,
  loading,
  onFilterMissingAlt,
}: {
  stats: MediaStats | null;
  loading: boolean;
  onFilterMissingAlt?: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-[11px] text-text-muted">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading storage figures...
      </div>
    );
  }

  if (!stats) return null;

  const altTotal = stats.with_alt + stats.without_alt;
  const altPct = altTotal === 0 ? 100 : Math.round((stats.with_alt / altTotal) * 100);
  const sizeBuckets = [
    { key: "under_100kb", label: "< 100 KB" },
    { key: "under_500kb", label: "100–500 KB" },
    { key: "under_1mb", label: "500 KB–1 MB" },
    { key: "over_1mb", label: "≥ 1 MB" },
  ] as const;
  const sizeTotal = sizeBuckets.reduce((a, b) => a + stats.by_size[b.key], 0);
  const mimeEntries = Object.entries(stats.by_mime).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat
          label="Total storage"
          value={formatBytes(stats.total_bytes)}
          sub={`${stats.file_count} file${stats.file_count === 1 ? "" : "s"}`}
        />
        <Stat label="Products with media" value={stats.product_count} />
        <Stat
          label="Awaiting attachment"
          value={stats.unattached_count}
          sub="uploaded, not on a product"
        />
        <Stat
          label="Missing alt text"
          value={stats.without_alt}
          tone={stats.without_alt > 0 ? "warn" : "default"}
          sub={`${altPct}% described`}
        />
      </div>

      {stats.without_alt > 0 && onFilterMissingAlt && (
        <button
          type="button"
          onClick={onFilterMissingAlt}
          className="flex items-center gap-2 w-full text-left rounded-lg border border-badge-discount/40 bg-badge-discount/5 px-3 py-2 text-[11px] text-badge-discount hover:bg-badge-discount/10"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            {stats.without_alt} image{stats.without_alt === 1 ? " has" : "s have"} no alt
            text. Filter the library to fix them.
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-surface-subtle rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            Size distribution
          </p>
          {sizeTotal === 0 ? (
            <p className="text-[11px] text-text-muted">No files yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sizeBuckets.map((b) => {
                const n = stats.by_size[b.key];
                const pct = sizeTotal === 0 ? 0 : Math.round((n / sizeTotal) * 100);
                return (
                  <li key={b.key} className="flex items-center gap-2">
                    <span className="text-[10px] text-text-muted w-20 shrink-0">
                      {b.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-border-light rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-muted w-8 text-right">{n}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="bg-surface-subtle rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            File types
          </p>
          {mimeEntries.length === 0 ? (
            <p className="text-[11px] text-text-muted">No files yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {mimeEntries.map(([mime, n]) => (
                <li key={mime} className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted flex-1 truncate">
                    {mime.replace("image/", "").toUpperCase()}
                  </span>
                  <div className="flex-1 h-1.5 bg-border-light rounded-full overflow-hidden max-w-24">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{
                        width: `${stats.file_count === 0 ? 0 : Math.round((n / stats.file_count) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted w-8 text-right">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {stats.largest.length > 0 && (
        <div className="bg-surface-subtle rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-2">
            Largest files
          </p>
          <ul className="flex flex-col gap-1">
            {stats.largest.slice(0, 5).map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 truncate text-on-surface">{f.file_name}</span>
                {!f.alt_text && (
                  <span className="text-[9px] text-badge-discount shrink-0">no alt</span>
                )}
                <span className="text-text-muted shrink-0">{formatBytes(f.byte_size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { formatBytes };
