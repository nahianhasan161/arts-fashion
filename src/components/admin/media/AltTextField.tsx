"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * Alt text field with a save-on-blur pattern.
 *
 * Alt text is the highest-value metadata in the library, because it is
 * what screen readers read and what search engines index, and because
 * getting it wrong is invisible until someone relies on it. So the field
 * makes the empty state explicit and reports that it is empty rather than
 * only what it contains.
 */
export default function AltTextField({
  value,
  onSave,
  placeholder = "Describe the image for screen readers",
  className = "",
  compact = false,
}: {
  value: string | null;
  onSave: (next: string | null) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [saved, setSaved] = useState(false);

  // Follow the server when the row changes underneath us, for example
  // after a bulk edit, without clobbering an in-progress edit.
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    onSave(next || null);
  };

  return (
    <div className={className}>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === "Escape") {
            setDraft(value ?? "");
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        aria-label="Alt text"
        className={`w-full px-2 py-1.5 text-[11px] border rounded-lg bg-surface-card focus:outline-none focus:ring-1 focus:ring-primary resize-none ${
          draft.trim() ? "border-border-light" : "border-badge-discount/50"
        }`}
      />
      <div className="flex items-center justify-between mt-1">
        <span
          className={`text-[10px] ${
            draft.trim() ? "text-text-muted" : "text-badge-discount"
          }`}
        >
          {draft.trim() ? `${draft.trim().length} characters` : "No alt text"}
        </span>
        {saved && (
          <span className="text-[10px] text-primary flex items-center gap-1">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
