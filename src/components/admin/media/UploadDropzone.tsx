"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { MEDIA_ACCEPTED_TYPES } from "@/types";

/**
 * Drag-and-drop upload target, shared by the product editor and the
 * media library.
 *
 * It is lifted out of ProductMediaManager rather than copied so there is
 * one place that decides what a browsable file should look like. The
 * server still re-sniffs every file's magic bytes, so this is about
 * feedback, not enforcement.
 */
export default function UploadDropzone({
  onFiles,
  disabled = false,
  disabledLabel = "Image limit reached",
  hint = "Multiple files at once are allowed.",
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  disabledLabel?: string;
  hint?: string;
  compact?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => !disabled && fileInput.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!disabled) fileInput.current?.click();
        }
      }}
      aria-disabled={disabled}
      className={`rounded-xl border-2 border-dashed text-center transition-colors ${
        compact ? "p-4" : "p-6"
      } ${
        dragOver
          ? "border-primary bg-primary/5 cursor-pointer"
          : disabled
            ? "border-border-light bg-surface-subtle opacity-60 cursor-not-allowed"
            : "border-border-light hover:border-primary/50 hover:bg-surface-subtle cursor-pointer"
      }`}
    >
      <input
        ref={fileInput}
        type="file"
        accept={MEDIA_ACCEPTED_TYPES.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          // Reset so re-picking the same file still fires onChange.
          e.target.value = "";
        }}
      />
      <Upload className={`mx-auto text-text-muted ${compact ? "w-4 h-4" : "w-6 h-6"}`} />
      <p className={`text-xs font-semibold text-on-surface mt-2 ${compact ? "" : ""}`}>
        {disabled ? disabledLabel : "Drop images here, or click to browse"}
      </p>
      {!compact && (
        <p className="text-[10px] text-text-muted mt-1">
          {disabled ? "Remove an image to upload another." : hint}
        </p>
      )}
    </div>
  );
}
