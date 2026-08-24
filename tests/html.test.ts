// @vitest-environment jsdom
//
// sanitizeHtml only runs its DOMParser allowlist path in a browser environment
// (under node it returns input unchanged). This file forces the jsdom env so the
// security-critical allowlist is actually exercised; the default node env for
// the DB-backed suites is unaffected (per-file pragma).
import { describe, it, expect } from "vitest";
import { sanitizeHtml, stripHtml, toInitialHtml } from "@/lib/html";

describe("sanitizeHtml — allowlist", () => {
  it("keeps the base formatting tags", () => {
    const html =
      "<h2>H</h2><h3>h</h3><p>x <strong>b</strong> <em>i</em> <u>u</u> <code>c</code></p>" +
      "<pre><code>block</code></pre><ul><li>a</li></ul><ol><li>b</li></ol>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps details/summary (spoiler) tags", () => {
    const html = "<details><summary>TA</summary><p>hidden</p></details>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("keeps the minimal table grid tags", () => {
    const html =
      "<table><tbody><tr><th><p>H</p></th></tr><tr><td><p>c</p></td></tr></tbody></table>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("strips ALL attributes — colspan, style, class", () => {
    const html =
      '<table style="min-width:50px"><tbody><tr>' +
      '<th colspan="2" rowspan="1" class="x"><p>H</p></th></tr></tbody></table>';
    const out = sanitizeHtml(html);
    expect(out).not.toMatch(/colspan|rowspan|style|class/);
    expect(out).toBe("<table><tbody><tr><th><p>H</p></th></tr></tbody></table>");
  });

  it("unwraps the detailsContent <div> wrapper to valid <details> HTML", () => {
    // This is exactly what editor.getHTML() emits; the div must be unwrapped so
    // TipTap re-parses a plain <details> on reopen.
    const html =
      '<details><summary>S</summary><div data-type="detailsContent"><p>body</p></div></details>';
    expect(sanitizeHtml(html)).toBe(
      "<details><summary>S</summary><p>body</p></details>"
    );
  });

  it("drops the colgroup/col sizing tags the editor emits for tables", () => {
    const html =
      '<table style="min-width:50px"><colgroup><col style="min-width:25px"></colgroup>' +
      '<tbody><tr><td colspan="1" rowspan="1"><p>c</p></td></tr></tbody></table>';
    expect(sanitizeHtml(html)).toBe(
      "<table><tbody><tr><td><p>c</p></td></tr></tbody></table>"
    );
  });

  it("removes a <script> element entirely (unwrap leaves no executable tag)", () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
  });

  it("strips an onclick handler and javascript: link, unwrapping the anchor", () => {
    const out = sanitizeHtml(
      '<p onclick="steal()">x</p><a href="javascript:alert(1)">link</a>'
    );
    expect(out).not.toMatch(/onclick|javascript:|<a/i);
    expect(out).toBe("<p>x</p>link");
  });

  it("is idempotent — sanitising already-clean stored HTML is a no-op", () => {
    const clean =
      "<h2>FA</h2><p>Body <strong>b</strong></p>" +
      "<details><summary>TA</summary><p>hidden</p>" +
      "<table><tbody><tr><th><p></p></th></tr></tbody></table></details><p></p>";
    expect(sanitizeHtml(clean)).toBe(clean);
  });
});

describe("stripHtml — card teasers with table markup", () => {
  it("reduces a table to its plain cell text", () => {
    expect(
      stripHtml("<table><tbody><tr><th>Name</th><td>Ada</td></tr></tbody></table>")
    ).toBe("Name Ada");
  });
});

describe("toInitialHtml — legacy import", () => {
  it("passes through content that is already HTML", () => {
    expect(toInitialHtml("<p>hi</p>")).toBe("<p>hi</p>");
  });
  it("escapes legacy plain text and turns newlines into <br>", () => {
    expect(toInitialHtml("a<b\nc")).toBe("a&lt;b<br>c");
  });
});
