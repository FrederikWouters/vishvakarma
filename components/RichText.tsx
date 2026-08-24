"use client";

import { useEditor, EditorContent, useEditorState, type Editor } from "@tiptap/react";
import { editorExtensions } from "./richTextExtensions";
import { toInitialHtml } from "@/lib/html";

// Re-exported for existing importers; the implementations live in lib/html.
export { sanitizeHtml, stripHtml } from "@/lib/html";

type ToggleState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  h2: boolean;
  h3: boolean;
  paragraph: boolean;
  bullet: boolean;
  ordered: boolean;
  code: boolean;
  codeBlock: boolean;
  details: boolean;
  inTable: boolean;
};

const EMPTY_STATE: ToggleState = {
  bold: false, italic: false, underline: false, h2: false, h3: false,
  paragraph: false, bullet: false, ordered: false, code: false,
  codeBlock: false, details: false, inTable: false,
};

// A toolbar toggle: reflects its active mark/node via aria-pressed for screen
// readers (WCAG 4.1.2). mousedown (not click) keeps the editor selection.
function Toggle({
  label,
  title,
  active,
  onRun,
}: {
  label: string;
  title: string;
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      className={`rte-btn${active ? " active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      {label}
    </button>
  );
}

// A one-shot action (no toggle state): insert table, add/remove row/column.
function Action({
  label,
  title,
  onRun,
}: {
  label: string;
  title: string;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      className="rte-btn"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      {label}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState<ToggleState>({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            paragraph: e.isActive("paragraph"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            code: e.isActive("code"),
            codeBlock: e.isActive("codeBlock"),
            details: e.isActive("details"),
            inTable: e.isActive("table"),
          }
        : EMPTY_STATE,
  }) ?? EMPTY_STATE;

  if (!editor) return <div className="rte-toolbar" role="toolbar" aria-label="Formatting" />;

  const chain = () => editor.chain().focus();

  return (
    <div className="rte-toolbar" role="toolbar" aria-label="Text formatting">
      <Toggle label="B" title="Bold" active={state.bold} onRun={() => chain().toggleBold().run()} />
      <Toggle label="I" title="Italic" active={state.italic} onRun={() => chain().toggleItalic().run()} />
      <Toggle label="U" title="Underline" active={state.underline} onRun={() => chain().toggleUnderline().run()} />
      <Toggle label="H2" title="Heading" active={state.h2} onRun={() => chain().toggleHeading({ level: 2 }).run()} />
      <Toggle label="H3" title="Subheading" active={state.h3} onRun={() => chain().toggleHeading({ level: 3 }).run()} />
      <Toggle label="P" title="Normal text" active={state.paragraph} onRun={() => chain().setParagraph().run()} />
      <Toggle label="•" title="Bullet list" active={state.bullet} onRun={() => chain().toggleBulletList().run()} />
      <Toggle label="1." title="Numbered list" active={state.ordered} onRun={() => chain().toggleOrderedList().run()} />
      <Toggle label="</>" title="Inline code" active={state.code} onRun={() => chain().toggleCode().run()} />
      <Toggle label="{ }" title="Code block" active={state.codeBlock} onRun={() => chain().toggleCodeBlock().run()} />
      <Toggle
        label="Spoiler"
        title="Spoiler / collapsible section (for FA / TA)"
        active={state.details}
        onRun={() =>
          state.details ? chain().unsetDetails().run() : chain().setDetails().run()
        }
      />
      <Action
        label="Table"
        title="Insert table"
        onRun={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      {state.inTable && (
        <>
          <span className="rte-sep" aria-hidden="true" />
          <Action label="+Row" title="Add row below" onRun={() => chain().addRowAfter().run()} />
          <Action label="−Row" title="Delete row" onRun={() => chain().deleteRow().run()} />
          <Action label="+Col" title="Add column right" onRun={() => chain().addColumnAfter().run()} />
          <Action label="−Col" title="Delete column" onRun={() => chain().deleteColumn().run()} />
          <Action label="✕Table" title="Delete table" onRun={() => chain().deleteTable().run()} />
        </>
      )}
    </div>
  );
}

export function RichTextEditor({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: editorExtensions,
    // Seed once from the stored HTML (or legacy plain text). We never re-push
    // content on prop change, so the caret never jumps — the parent mounts a new
    // editor per ticket, matching the old seed-once contract.
    content: toInitialHtml(initialValue),
    // App Router SSR: do not render during SSR, avoids hydration mismatch.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rte-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Ticket description",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  return (
    <div className="rte">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
