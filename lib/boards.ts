// Single source of truth for the three boards and their columns.

export const BOARDS = [
  { slug: "analysis", label: "Analysis" },
  { slug: "development", label: "Development" },
  { slug: "acceptance", label: "Acceptance" },
] as const;

export type BoardSlug = (typeof BOARDS)[number]["slug"];

export const BOARD_SLUGS: BoardSlug[] = BOARDS.map((b) => b.slug);

export function isBoardSlug(value: string): value is BoardSlug {
  return BOARD_SLUGS.includes(value as BoardSlug);
}

export function boardLabel(slug: string): string {
  return BOARDS.find((b) => b.slug === slug)?.label ?? slug;
}

// Default column set for a new project, in order. Each column belongs to one board.
export const DEFAULT_COLUMNS: { name: string; board: BoardSlug }[] = [
  { name: "Open", board: "analysis" },
  { name: "Analysing", board: "analysis" },
  { name: "Analysed", board: "analysis" },
  { name: "To Develop", board: "development" },
  { name: "Developing", board: "development" },
  { name: "Developed", board: "development" },
  { name: "To Test", board: "development" },
  { name: "Tested", board: "development" },
  { name: "To Accept", board: "acceptance" },
  { name: "Accepted", board: "acceptance" },
  { name: "Closed", board: "acceptance" },
  { name: "Cancelled", board: "acceptance" },
];

export const CANCELLED_COLUMN = "Cancelled";
