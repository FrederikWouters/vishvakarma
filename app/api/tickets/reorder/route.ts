import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revalidateBoards } from "@/lib/revalidate";

// PATCH /api/tickets/reorder — set the exact order of tickets within a column.
// Body: { columnId, orderedIds }. Each listed ticket is moved into columnId and
// assigned order = its index in the list. Runs in a transaction so the column's
// ordering is rewritten atomically (no colliding/duplicate order values).
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

  // Only reorder tickets that actually belong to this column's project — guards
  // against stray ids from a stale client.
  const tickets = await prisma.ticket.findMany({
    where: { id: { in: orderedIds }, projectId: column.projectId },
    select: { id: true },
  });
  const valid = new Set(tickets.map((t) => t.id));
  const ids = orderedIds.filter((id) => valid.has(id));

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.ticket.update({ where: { id }, data: { columnId, order: index } })
    )
  );

  revalidateBoards();
  return NextResponse.json({ ok: true, columnId, count: ids.length });
}
