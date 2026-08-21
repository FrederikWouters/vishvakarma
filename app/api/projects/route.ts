import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEFAULT_COLUMNS } from "@/lib/boards";
import { LIMITS } from "@/lib/limits";
import { revalidateProjectsEverywhere, revalidateSettings } from "@/lib/revalidate";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const key = typeof body?.key === "string" ? body.key.trim().toUpperCase() : "";

  if (!name || !key) {
    return NextResponse.json({ error: "name and key are required" }, { status: 400 });
  }
  if (name.length > LIMITS.projectName) {
    return NextResponse.json(
      { error: `Project name must be ${LIMITS.projectName} characters or fewer` },
      { status: 400 }
    );
  }
  if (key.length > LIMITS.projectKey) {
    return NextResponse.json(
      { error: `Key must be ${LIMITS.projectKey} characters or fewer` },
      { status: 400 }
    );
  }

  const existing = await prisma.project.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json({ error: `Key "${key}" is already in use` }, { status: 409 });
  }

  const project = await prisma.project.create({
    data: {
      name,
      key,
      columns: {
        create: DEFAULT_COLUMNS.map((c, i) => ({ name: c.name, board: c.board, order: i })),
      },
    },
  });

  // Refreshes the home grid and the sidebar (root layout) on every route.
  revalidateProjectsEverywhere();
  revalidateSettings();
  return NextResponse.json(project, { status: 201 });
}
