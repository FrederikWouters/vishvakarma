import { revalidatePath } from "next/cache";

// Cache-invalidation helpers for the server pages, called from mutating API
// routes. Replaces the old blanket `export const dynamic = "force-dynamic"`, so
// pages are cached between writes and refreshed only when data actually changes.

// All board pages (any project, any board) — tickets/columns/labels changed.
export function revalidateBoards() {
  revalidatePath("/projects/[id]/board/[board]", "page");
}

// The settings page — columns/labels (and their ticket counts) changed.
export function revalidateSettings() {
  revalidatePath("/settings");
}

// The projects home grid — a project or its ticket count changed.
export function revalidateHome() {
  revalidatePath("/");
}

// The sidebar lives in the root layout, so a new/removed project must refresh
// every route's layout.
export function revalidateProjectsEverywhere() {
  revalidatePath("/", "layout");
}
