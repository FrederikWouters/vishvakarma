import { describe, it, expect } from "vitest";
import { LIMITS, withinLimit } from "@/lib/limits";
import { stripHtml } from "@/lib/html";

describe("withinLimit", () => {
  it("accepts strings up to the cap (after trimming)", () => {
    expect(withinLimit("a".repeat(LIMITS.ticketTitle), LIMITS.ticketTitle)).toBe(true);
    expect(withinLimit("  hi  ", 2)).toBe(true);
  });
  it("rejects strings over the cap", () => {
    expect(withinLimit("a".repeat(LIMITS.ticketTitle + 1), LIMITS.ticketTitle)).toBe(false);
  });
});

describe("stripHtml", () => {
  it("reduces description HTML to plain text for card teasers", () => {
    expect(stripHtml("<h2>FA</h2><p>Body <strong>bold</strong></p>")).toBe("FA Body bold");
    expect(stripHtml("<details><summary>TA</summary><p>hidden</p></details>")).toBe("TA hidden");
  });
});
