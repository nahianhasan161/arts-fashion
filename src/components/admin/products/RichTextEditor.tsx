"use client";

/**
 * A rich-text editor for a product description.
 *
 * TipTap is already a dependency of this project (StarterKit covers every mark
 * and node used here), so it is used rather than a contenteditable written by
 * hand. The reason to own the component rather than drop `EditorContent` into
 * a form is the contract with the server: the HTML is stored on
 * products.description and rendered on the storefront, so the set of marks and
 * nodes allowed here is a security boundary, not a formatting preference.
 *
 * Two things follow from that:
 *
 *   - The schema is declared explicitly, so an extension added to StarterKit
 *     upstream cannot silently widen what can be stored.
 *   - The generated HTML is stripped and normalised on the server as well
 *     (see src/lib/admin/rich-text.ts), because the browser is not the only
 *     thing that can post to this route.
 */

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Strikethrough, List, ListOrdered, Link2, Link2Off, Undo2, Redo2 } from "lucide-react";
import { sanitizeProductHtml } from "@/lib/admin/rich-text";

// StarterKit is the broad preset. Narrowing it to the node and mark names below
// is what keeps the stored HTML to a known set; an unlisted extension that
// arrives in a future upgrade will throw at import rather than be persisted.
const EXTENSIONS = [
  StarterKit.configure({
    // A product description is prose, not a document. The nodes removed here
    // are the ones that either nest arbitrarily (headings, blockquotes) or
    // carry a whole separate grammar (code blocks, rules).
    heading: false,
    codeBlock: false,
    horizontalRule: false,
    blockquote: false,
  }),
];

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Shown when the sanitiser strips more than it keeps. */
  onSanitised?: (removed: boolean) => void;
}

/**
 * TipTap writes to the DOM immediately on mount and after every transaction,
 * which fights an external value: setting the editor inside onUpdate would
 * recurse. The external value is therefore pushed in only when it actually
 * differs from what was last emitted, and only while the editor is not
 * focused. While the field has focus the user owns the content, so an async
 * reload of the parent cannot move the caret mid-sentence.
 */
function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function RichTextEditor({ value, onChange, placeholder, className, onSanitised }: RichTextEditorProps) {
  // The HTML most recently emitted by the editor. A parent that round-trips
  // that value back is not an external change and must not be re-applied,
  // which would reset the caret on every keystroke.
  const lastPushedRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: sanitizeProductHtml(value),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "min-h-32 w-full px-3 py-2 text-sm leading-relaxed outline-none " +
          "empty:before:pointer-events-none empty:before:text-muted-foreground " +
          "empty:before:content-[attr(data-placeholder)]",
        "data-placeholder": placeholder ?? "Describe the fabric, the cut, and how it fits…",
        "aria-label": "Product description",
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      lastPushedRef.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === lastPushedRef.current) return;
    if (editor.isFocused) return;
    if (editor.getHTML() === value) return;

    const cleaned = sanitizeProductHtml(value);
    if (cleaned !== value) onSanitised?.(true);
    lastPushedRef.current = cleaned;
    editor.commands.setContent(cleaned, { emitUpdate: false });
  }, [editor, value, onSanitised]);

  if (!editor) {
    // TipTap needs the DOM to mount into. Rendering a plain textarea keeps
    // the field usable in the first paint and, more importantly, keeps a
    // server-rendered page from showing an empty hole where the description
    // goes.
    return (
      <textarea
        className={`min-h-32 w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm ${className ?? ""}`}
        value={value.replace(/<[^>]*>/g, "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={`rounded-lg border border-border-light focus-within:ring-1 focus-within:ring-primary/20 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border-light p-1">
        <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="w-4 h-4" />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-border-light" />
        <ToolbarButton
          label="Bulleted list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 className="w-4 h-4" />
        </ToolbarButton>
        {editor.isActive("link") && (
          <ToolbarButton label="Remove link" onClick={setLink}>
            <Link2Off className="w-4 h-4" />
          </ToolbarButton>
        )}
        <span className="mx-1 h-4 w-px bg-border-light" />
        <ToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
