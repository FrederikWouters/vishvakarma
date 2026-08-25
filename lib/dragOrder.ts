// Pure geometry / ordering helpers for the board's custom pointer-drag (VSK-14).
//
// The drag interaction itself (pointer capture, elementFromPoint hit-testing,
// requestAnimationFrame auto-scroll, FLIP-ish snap) lives in components/Board.tsx
// and can only be exercised in a real browser. These three functions hold the
// *decisions* that drive it, extracted so they are unit-testable under the
// repo's node-only vitest (no jsdom/RTL). Keep them free of DOM references.

/**
 * Which ticket id the dragged card should be inserted BEFORE within a column,
 * given the pointer's Y and the hovered card's rect. `null` = append at the end.
 *
 * Mirrors the original midpoint rule (Board.tsx native onDragOver): above the
 * hovered card's vertical midpoint drops before it; below the midpoint drops
 * before the next card (or at the end when the hovered card is the last one).
 */
export function computeDropBeforeId(
  pointerY: number,
  cardTop: number,
  cardHeight: number,
  orderedIds: string[],
  hoveredId: string
): string | null {
  const belowMidpoint = pointerY - cardTop > cardHeight / 2;
  if (!belowMidpoint) return hoveredId;
  const idx = orderedIds.indexOf(hoveredId);
  if (idx < 0) return hoveredId; // defensive: unknown card → treat as "before it"
  return orderedIds[idx + 1] ?? null;
}

/**
 * Reorder `ids` by moving `id` one slot up or down. Returns a NEW array. It is a
 * no-op copy when `id` is absent, already first and moving up, or already last
 * and moving down. Powers the ⋯-menu "Move up"/"Move down" items — the non-drag,
 * keyboard-reachable reorder path required by WCAG 2.5.7 (Dragging Movements).
 */
export function moveWithinColumn(
  ids: string[],
  id: string,
  dir: "up" | "down"
): string[] {
  const idx = ids.indexOf(id);
  if (idx < 0) return ids.slice();
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= ids.length) return ids.slice();
  const out = ids.slice();
  [out[idx], out[swap]] = [out[swap], out[idx]];
  return out;
}

/**
 * Edge-proximity auto-scroll direction along one axis: -1 (scroll toward the
 * start / up / left), 1 (toward the end / down / right), or 0 (no scroll).
 * `band` is the px distance from an edge inside which scrolling triggers.
 * A pointer drag does not auto-scroll like native DnD, so the board needs this
 * to reach an off-screen slot (esp. on mobile).
 */
export function autoScrollDir(
  pointer: number,
  start: number,
  end: number,
  band: number
): -1 | 0 | 1 {
  if (pointer - start < band) return -1;
  if (end - pointer < band) return 1;
  return 0;
}
