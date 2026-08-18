import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  const column = await prisma.column.findUnique({ where: { id: columnId } });
  if (!column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const ticket = await prisma.ticket.create({
    data: { columnId, title, description, order },
  });

  return NextResponse.json(ticket, { status: 201 });
}
