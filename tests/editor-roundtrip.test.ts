// @vitest-environment jsdom
//
// Security-critical regression test. The description sanitizer strips ALL
// attributes; the risk (flagged in the VSK-26 TA) is that the HTML TipTap emits
// for tables and the details/spoiler node might not survive that strip and
// re-parse. This proves the full round-trip against the EXACT production
// extension set: build content -> getHTML -> sanitizeHtml (stored) ->
// re-open in a fresh editor -> getHTML -> sanitizeHtml. The stored form must be
// stable (idempotent) and must still contain the table and the details.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "@/components/richTextExtensions";
import { sanitizeHtml } from "@/lib/html";

function mkEditor() {
  return new Editor({ extensions: editorExtensions });
}

describe("TipTap getHTML → sanitize → re-parse round-trip (VSK-26)", () => {
  it("keeps a table nested in a details/spoiler stable across a save+reopen", () => {
    const e1 = mkEditor();
    e1.commands.setContent(
      "<h2>FA</h2><p>Body <strong>b</strong></p>" +
        "<details><summary>TA</summary><p>hidden</p></details>"
    );
    e1.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });

    const stored = sanitizeHtml(e1.getHTML());
    // The stored form carries no stripped-away attributes and no wrapper div.
    expect(stored).not.toMatch(/colspan|rowspan|colgroup|style=|data-type/);
    expect(stored).toMatch(/<details><summary>TA<\/summary>/);
    expect(stored).toMatch(/<table>.*<th>.*<\/table>/s);

    // Reopen: feed the stored HTML into a fresh editor and re-emit.
    const e2 = mkEditor();
    e2.commands.setContent(stored);
    const reStored = sanitizeHtml(e2.getHTML());

    // Idempotent: what we store on the second save equals the first.
    expect(reStored).toBe(stored);
    e1.destroy();
    e2.destroy();
  });

  it("imports legacy allowed-subset HTML (details without the wrapper div) without loss", () => {
    const legacy = "<details><summary>S</summary><p>kept</p></details>";
    const e = mkEditor();
    e.commands.setContent(legacy);
    const stored = sanitizeHtml(e.getHTML());
    // The details survives with no wrapper div / stripped attributes. TipTap
    // appends a trailing empty <p> after a block node so the caret can escape it;
    // that is harmless (stripHtml collapses it on the empty-body check).
    expect(stored).not.toMatch(/data-type|<div/);
    expect(stored.replace(/<p><\/p>$/, "")).toBe(legacy);
    e.destroy();
  });

  it("emits an empty paragraph for empty content (collapses to '' via stripHtml)", () => {
    const e = mkEditor();
    e.commands.setContent("");
    expect(e.getHTML()).toBe("<p></p>");
    e.destroy();
  });
});
