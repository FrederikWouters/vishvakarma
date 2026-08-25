import { describe, it, expect } from "vitest";
import {
  computeDropBeforeId,
  moveWithinColumn,
  autoScrollDir,
} from "@/lib/dragOrder";

// VSK-14: the decision logic behind the custom pointer-drag. The interaction
// (capture, elementFromPoint, rAF, snap) is browser-only and covered manually;
// these lock the pure rules.
describe("computeDropBeforeId (midpoint rule)", () => {
  const ids = ["a", "b", "c"];
  // Card "b" occupies y 100..140 (top 100, height 40) → midpoint 120.

  it("above the midpoint drops before the hovered card", () => {
    expect(computeDropBeforeId(110, 100, 40, ids, "b")).toBe("b");
  });

  it("below the midpoint drops before the next card", () => {
    expect(computeDropBeforeId(130, 100, 40, ids, "b")).toBe("c");
  });

  it("below the midpoint of the last card appends (null)", () => {
    expect(computeDropBeforeId(130, 100, 40, ids, "c")).toBeNull();
  });

  it("exactly at the midpoint counts as above (before the card)", () => {
    expect(computeDropBeforeId(120, 100, 40, ids, "b")).toBe("b");
  });

  it("is defensive when the hovered id is unknown", () => {
    expect(computeDropBeforeId(130, 100, 40, ids, "zzz")).toBe("zzz");
  });
});

describe("moveWithinColumn (⋯-menu Move up/down)", () => {
  it("moves a middle item up (swaps with previous)", () => {
    expect(moveWithinColumn(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
  });

  it("moves a middle item down (swaps with next)", () => {
    expect(moveWithinColumn(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("is a no-op moving the first item up", () => {
    expect(moveWithinColumn(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
  });

  it("is a no-op moving the last item down", () => {
    expect(moveWithinColumn(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
  });

  it("returns a new array (does not mutate the input)", () => {
    const input = ["a", "b", "c"];
    const out = moveWithinColumn(input, "b", "up");
    expect(out).not.toBe(input);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("is a no-op copy when the id is absent", () => {
    expect(moveWithinColumn(["a", "b"], "zzz", "up")).toEqual(["a", "b"]);
  });
});

describe("autoScrollDir (edge proximity)", () => {
  // Range 0..1000, band 48.
  it("scrolls toward the start near the start edge", () => {
    expect(autoScrollDir(20, 0, 1000, 48)).toBe(-1);
  });

  it("scrolls toward the end near the end edge", () => {
    expect(autoScrollDir(980, 0, 1000, 48)).toBe(1);
  });

  it("does not scroll in the middle", () => {
    expect(autoScrollDir(500, 0, 1000, 48)).toBe(0);
  });

  it("does not scroll exactly at the band boundary", () => {
    expect(autoScrollDir(48, 0, 1000, 48)).toBe(0);
    expect(autoScrollDir(952, 0, 1000, 48)).toBe(0);
  });
});
