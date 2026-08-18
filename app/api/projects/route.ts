import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

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

  const existing = await prisma.project.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json({ error: `Key "${key}" is already in use` }, { status: 409 });
  }

  const project = await prisma.project.create({
    data: {
      name,
      key,
      columns: {
        create: DEFAULT_COLUMNS.map((n, i) => ({ name: n, order: i })),
      },
    },
  });

  return NextResponse.json(project, { status: 201 });
}
