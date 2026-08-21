"use client";

import { useEffect, useRef } from "react";
import { escapeHtml, toInitialHtml } from "@/lib/html";

// Re-exported for existing importers; the implementations live in lib/html.
export { sanitizeHtml, stripHtml } from "@/lib/html";

type Cmd =
  | { kind: "exec"; command: string; value?: string }
  | { kind: "insert"; html: (sel: string) => string };

const TOOLS: { label: string; title: string; cmd: Cmd }[] = [
  { label: "B", title: "Bold", cmd: { kind: "exec", command: "bold" } },
  { label: "I", title: "Italic", cmd: { kind: "exec", command: "italic" } },
  { label: "U", title: "Underline", cmd: { kind: "exec", command: "underline" } },
  { label: "H2", title: "Heading", cmd: { kind: "exec", command: "formatBlock", value: "H2" } },
  { label: "H3", title: "Subheading", cmd: { kind: "exec", command: "formatBlock", value: "H3" } },
  { label: "P", title: "Normal text", cmd: { kind: "exec", command: "formatBlock", value: "P" } },
  { label: "•", title: "Bullet list", cmd: { kind: "exec", command: "insertUnorderedList" } },
  {
    label: "</>",
    title: "Inline code",
    cmd: { kind: "insert", html: (s) => `<code>${escapeHtml(s || "code")}</code>` },
  },
  {
    label: "{ }",
    title: "Code block",
    cmd: { kind: "insert", html: (s) => `<pre><code>${escapeHtml(s || "")}</code></pre><p><br></p>` },
  },
  {
    label: "Spoiler",
    title: "Spoiler / collapsible section (for FA / TA)",
    cmd: {
      kind: "insert",
      html: (s) =>
        `<details><summary>Details</summary><p>${escapeHtml(s || "…")}</p></details><p><br></p>`,
    },
  },
];

export function RichTextEditor({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Seed the (uncontrolled) editor once; re-seeding on every render would move
  // the caret. The component is keyed per-ticket by its parent, so mount === new
  // ticket.
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = toInitialHtml(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function run(cmd: Cmd) {
    ref.current?.focus();
    if (cmd.kind === "exec") {
      document.execCommand(cmd.command, false, cmd.value);
    } else {
      const sel = window.getSelection()?.toString() ?? "";
      document.execCommand("insertHTML", false, cmd.html(sel));
    }
    emit();
  }

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.title}
            type="button"
            className="rte-btn"
            title={t.title}
            // mousedown (not click) so the editor keeps its selection.
            onMouseDown={(e) => {
              e.preventDefault();
              run(t.cmd);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="rte-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
      />
    </div>
  );
}
