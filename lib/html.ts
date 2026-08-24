// Pure HTML helpers for ticket description rich text. Kept free of JSX/React so
// they can be imported anywhere (server, client, tests).

// Tags we keep in stored description HTML. Everything else is unwrapped to its
// text content; all attributes are stripped (no style/href/on* survive).
const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U",
  "H2", "H3", "CODE", "PRE", "DETAILS", "SUMMARY",
  "UL", "OL", "LI",
  // Tables — minimal grid only. No attributes are ever kept (below), so
  // colspan/rowspan/colgroup/style emitted by the editor are stripped and the
  // editor re-parses a plain grid on reopen. TipTap's detailsContent wrapper
  // <div> is unwrapped (DIV not allowed), leaving valid <details> HTML.
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);

// Allowlist sanitizer. Runs in the browser (uses DOMParser); on the server it
// passes through — the server route applies its own regex strip as a backstop.
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("*").forEach((el) => {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    [...el.attributes].forEach((a) => el.removeAttribute(a.name));
  });
  return doc.body.innerHTML;
}

// Plain-text reduction for card teasers — isomorphic (no DOMParser).
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Existing descriptions are plain text; render their newlines rather than
// collapsing them when they first open in the HTML editor.
export function toInitialHtml(value: string): string {
  if (/<[a-z][\s\S]*>/i.test(value)) return value; // already HTML
  return escapeHtml(value).replace(/\n/g, "<br>");
}
