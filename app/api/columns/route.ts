import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isBoardSlug } from "@/lib/boards";
import { LIMITS } from "@/lib/limits";
import { revalidateBoards, revalidateSettings, revalidateHome } from "@/lib/revalidate";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const board = typeof body?.board === "string" ? body.board : "";

  if (!projectId || !name) {
    return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
  }
  if (name.length > LIMITS.columnName) {
    return NextResponse.json(
      { error: `Column name must be ${LIMITS.columnName} characters or fewer` },
      { status: 400 }
    );
  }
  if (!isBoardSlug(board)) {
    return NextResponse.json({ error: "board must be analysis, development, or acceptance" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Append to the end of the project's column ordering.
  const last = await prisma.column.findFirst({
    where: { projectId },
    orderBy: { order: "desc" },
  });
  const order = last ? last.order + 1 : 0;

  const column = await prisma.column.create({
    data: { projectId, name, board, order },
  });

  revalidateBoards();
  revalidateSettings();
  revalidateHome();
  return NextResponse.json(column, { status: 201 });
}
