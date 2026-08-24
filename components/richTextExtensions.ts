// The TipTap/ProseMirror extension set for the ticket description editor.
// Framework-agnostic (no JSX/React) so unit tests can build a headless Editor
// from the exact production schema and exercise the security-critical
// getHTML → sanitize → re-parse round-trip against one source of truth.
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Details, DetailsSummary, DetailsContent } from "@tiptap/extension-details";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

export const editorExtensions = [
  // StarterKit ships bold/italic/underline/headings/lists/inline-code/code-block.
  // DISABLE the marks/nodes whose HTML the description sanitizer would strip on
  // save (blockquote, <hr>, <s>, <a>) so the editor never shows formatting that
  // silently disappears — WYSIWYG stays honest against the allowlist in lib/html.
  StarterKit.configure({
    blockquote: false,
    horizontalRule: false,
    strike: false,
    link: false,
  }),
  Placeholder.configure({ placeholder: "Add a description…" }),
  // Collapsible spoiler/section for FA/TA. MIT (open-sourced 2025), editable
  // summary, nestable. getHTML() emits a <div data-type="detailsContent">
  // wrapper; the save-time sanitizer unwraps that div and TipTap re-parses the
  // plain <details><summary>…</summary>… on reopen (verified round-trip).
  Details,
  DetailsSummary,
  DetailsContent,
  // Minimal grid: no column resize, no merged cells — so getHTML() carries no
  // attribute the sanitizer must whitelist. colspan/rowspan/colgroup/style are
  // all stripped and TipTap defaults them back to 1 on reopen.
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
];
