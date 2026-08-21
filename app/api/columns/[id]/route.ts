import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { revalidateBoards, revalidateSettings, revalidateHome } from "@/lib/revalidate";

// PATCH /api/columns/[id] — rename a column.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > LIMITS.columnName) {
    return NextResponse.json(
      { error: `Column name must be ${LIMITS.columnName} characters or fewer` },
      { status: 400 }
    );
  }

  const existing = await prisma.column.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const column = await prisma.column.update({ where: { id }, data: { name } });
  revalidateBoards();
  revalidateSettings();
  return NextResponse.json(column);
}

// DELETE /api/columns/[id] — delete a column, but only when it holds no tickets.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const column = await prisma.column.findUnique({
    where: { id },
    include: { _count: { select: { tickets: true } } },
  });
  if (!column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }
  if (column._count.tickets > 0) {
    return NextResponse.json(
      { error: "Move or delete its tickets before deleting this column" },
      { status: 409 }
    );
  }

  await prisma.column.delete({ where: { id } });
  revalidateBoards();
  revalidateSettings();
  revalidateHome();
  return NextResponse.json({ ok: true });
}
