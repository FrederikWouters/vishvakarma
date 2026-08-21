import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { revalidateSettings } from "@/lib/revalidate";

// GET /api/labels?projectId=... — all labels defined on a project.
export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const labels = await prisma.label.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(labels);
}

// POST /api/labels — create a label on a project. Idempotent on [projectId, name].
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const color =
    typeof body?.color === "string" && body.color.trim() ? body.color.trim() : "#6b7280";

  if (!projectId || !name) {
    return NextResponse.json({ error: "projectId and name are required" }, { status: 400 });
  }
  if (name.length > LIMITS.labelName) {
    return NextResponse.json(
      { error: `Label name must be ${LIMITS.labelName} characters or fewer` },
      { status: 400 }
    );
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Reuse an existing label with the same name rather than erroring on the
  // unique constraint — the picker treats "create" and "pick existing" alike.
  const existing = await prisma.label.findUnique({
    where: { projectId_name: { projectId, name } },
  });
  if (existing) return NextResponse.json(existing, { status: 200 });

  const label = await prisma.label.create({ data: { projectId, name, color } });
  revalidateSettings();
  return NextResponse.json(label, { status: 201 });
}
