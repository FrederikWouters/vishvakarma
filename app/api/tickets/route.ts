import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { revalidateBoards, revalidateSettings } from "@/lib/revalidate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const columnId = typeof body?.columnId === "string" ? body.columnId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() || null : null;
  const order = Number.isInteger(body?.order) ? body.order : 0;

  if (!columnId || !title) {
    return NextResponse.json({ error: "columnId and title are required" }, { status: 400 });
  }
  if (title.length > LIMITS.ticketTitle) {
    return NextResponse.json(
      { error: `Title must be ${LIMITS.ticketTitle} characters or fewer` },
      { status: 400 }
    );
  }
  if (description && description.length > LIMITS.ticketDescription) {
    return NextResponse.json(
      { error: `Description is too long (max ${LIMITS.ticketDescription} characters)` },
      { status: 400 }
    );
  }

  const column = await prisma.column.findUnique({ where: { id: columnId } });
  if (!column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  // Assign the next per-project ticket number. Wrapped in a transaction so two
  // concurrent creates can't read the same max and collide on the
  // [projectId, number] unique constraint.
  const ticket = await prisma.$transaction(async (tx) => {
    const last = await tx.ticket.findFirst({
      where: { projectId: column.projectId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;
    return tx.ticket.create({
      data: { columnId, projectId: column.projectId, title, description, order, number },
    });
  });

  revalidateBoards();
  revalidateSettings();
  return NextResponse.json(ticket, { status: 201 });
}
