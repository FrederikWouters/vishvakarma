import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { revalidateBoards, revalidateSettings } from "@/lib/revalidate";

// PATCH /api/labels/[id] — rename and/or recolor a label.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { name?: string; color?: string } = {};
  if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body?.color === "string" && body.color.trim()) data.color = body.color.trim();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (data.name && data.name.length > LIMITS.labelName) {
    return NextResponse.json(
      { error: `Label name must be ${LIMITS.labelName} characters or fewer` },
      { status: 400 }
    );
  }

  const existing = await prisma.label.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  // A rename can collide with another label of the same name in the project.
  if (data.name && data.name !== existing.name) {
    const clash = await prisma.label.findUnique({
      where: { projectId_name: { projectId: existing.projectId, name: data.name } },
    });
    if (clash) {
      return NextResponse.json(
        { error: `A label named "${data.name}" already exists` },
        { status: 409 }
      );
    }
  }

  const label = await prisma.label.update({ where: { id }, data });
  // Rename/recolor shows on ticket chips too, so refresh boards.
  revalidateBoards();
  revalidateSettings();
  return NextResponse.json(label);
}

// DELETE /api/labels/[id] — delete a label; Prisma removes its ticket links.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.label.delete({ where: { id } });
    revalidateBoards();
    revalidateSettings();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }
}
