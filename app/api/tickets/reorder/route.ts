import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revalidateBoards } from "@/lib/revalidate";

// PATCH /api/tickets/reorder — set the exact order of tickets within a column.
// Body: { columnId, orderedIds }. Each listed ticket is moved into columnId and
// assigned an order matching its position in the list.
//
// Two behaviours worth calling out (VSK-24, Option A — diff-only):
//   1. Full-column reindex. The final order covers the WHOLE target column, not
//      only the ids passed: any ticket already in the column but absent from
//      orderedIds (a partial-lane caller) is appended after the listed ids in
//      its current relative order. This guarantees the lane always ends with a
//      clean, gapless, collision-free 0..n ordering — a partial caller can never
//      leave stale or duplicate `order` values behind.
//   2. Diff-only writes. Only rows whose stored `order` or `columnId` actually
//      differ from the computed target are written. For a typical single move
//      that is the handful of rows between the old and new slot, not the whole
//      lane, and a cross-lane drop's source column only rewrites the rows after
//      the removed slot. All writes still run in one $transaction, so the lane
//      is rewritten atomically (no colliding order values on partial failure).
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const columnId = typeof body?.columnId === "string" ? body.columnId : "";
  const orderedIds: string[] = Array.isArray(body?.orderedIds)
    ? body.orderedIds.filter((v: unknown): v is string => typeof v === "string")
    : [];

  if (!columnId || orderedIds.length === 0) {
    return NextResponse.json(
      { error: "columnId and a non-empty orderedIds are required" },
      { status: 400 }
    );
  }

  const column = await prisma.column.findUnique({ where: { id: columnId } });
  if (!column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  // Only accept ids that actually belong to this column's project — guards
  // against stray ids from a stale client. Preserve the caller's order and drop
  // duplicates.
  const valid = await prisma.ticket.findMany({
    where: { id: { in: orderedIds }, projectId: column.projectId },
    select: { id: true, order: true, columnId: true },
  });
  const validById = new Map(valid.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const listedIds: string[] = [];
  for (const id of orderedIds) {
    if (validById.has(id) && !seen.has(id)) {
      seen.add(id);
      listedIds.push(id);
    }
  }

  // Full-column reindex: tickets already in this column but not named by the
  // caller keep their place after the listed ids (in current order), so a
  // partial-lane call can't strand stale/duplicate `order` values.
  const extras = await prisma.ticket.findMany({
    where: { columnId, id: { notIn: listedIds.length ? listedIds : ["\0"] } },
    orderBy: { order: "asc" },
    select: { id: true, order: true, columnId: true },
  });

  // Current (columnId, order) for every ticket we might touch, for the diff.
  const current = new Map<string, { order: number; columnId: string }>();
  for (const t of valid) current.set(t.id, { order: t.order, columnId: t.columnId });
  for (const t of extras) current.set(t.id, { order: t.order, columnId: t.columnId });

  const finalOrder = [...listedIds, ...extras.map((t) => t.id)];

  // Diff: write only rows whose target column/order differs from what's stored.
  const writes = finalOrder.flatMap((id, index) => {
    const cur = current.get(id);
    if (cur && cur.columnId === columnId && cur.order === index) return [];
    return [prisma.ticket.update({ where: { id }, data: { columnId, order: index } })];
  });

  if (writes.length > 0) {
    await prisma.$transaction(writes);
  }

  revalidateBoards();
  return NextResponse.json({
    ok: true,
    columnId,
    count: finalOrder.length,
    written: writes.length,
  });
}
