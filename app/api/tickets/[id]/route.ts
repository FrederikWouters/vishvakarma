import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: {
    columnId?: string;
    order?: number;
    title?: string;
    description?: string | null;
  } = {};

  if (typeof body?.columnId === "string") data.columnId = body.columnId;
  if (Number.isInteger(body?.order)) data.order = body.order;
  if (typeof body?.title === "string") data.title = body.title.trim();
  if (typeof body?.description === "string")
    data.description = body.description.trim() || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    const ticket = await prisma.ticket.update({ where: { id }, data });
    return NextResponse.json(ticket);
  } catch {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.ticket.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
}
