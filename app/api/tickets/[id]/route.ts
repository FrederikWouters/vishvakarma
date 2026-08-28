import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { stripDangerousHtml } from "@/lib/html";
import { revalidateBoards, revalidateHome, revalidateSettings } from "@/lib/revalidate";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: { labels: { orderBy: { name: "asc" } } },
  });
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
  return NextResponse.json(ticket);
}

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
    labels?: { set: { id: string }[] };
  } = {};

  if (typeof body?.columnId === "string") data.columnId = body.columnId;
  if (Number.isInteger(body?.order)) data.order = body.order;
  if (typeof body?.title === "string") data.title = body.title.trim();
  if (typeof body?.description === "string")
    data.description = stripDangerousHtml(body.description).trim() || null;

  if (data.title !== undefined && data.title.length > LIMITS.ticketTitle) {
    return NextResponse.json(
      { error: `Title must be ${LIMITS.ticketTitle} characters or fewer` },
      { status: 400 }
    );
  }
  if (data.description && data.description.length > LIMITS.ticketDescription) {
    return NextResponse.json(
      { error: `Description is too long (max ${LIMITS.ticketDescription} characters)` },
      { status: 400 }
    );
  }
  // Replace the ticket's label set with exactly the given ids.
  if (Array.isArray(body?.labelIds)) {
    const ids: string[] = body.labelIds.filter(
      (v: unknown): v is string => typeof v === "string"
    );
    data.labels = { set: ids.map((id) => ({ id })) };
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const existing = await prisma.ticket.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }

  // Moving to a different column without an explicit order: append to the end
  // of the target column. Lets "Advance" work across boards without the client
  // knowing the target column's current contents.
  if (data.columnId && data.columnId !== existing.columnId && data.order === undefined) {
    const last = await prisma.ticket.findFirst({
      where: { columnId: data.columnId },
      orderBy: { order: "desc" },
    });
    data.order = last ? last.order + 1 : 0;
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data,
    include: { labels: { orderBy: { name: "asc" } } },
  });
  revalidateBoards();
  revalidateSettings();
  return NextResponse.json(ticket);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.ticket.delete({ where: { id } });
    revalidateBoards();
    revalidateSettings();
    revalidateHome();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  }
}
