import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Board from "@/components/Board";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      columns: {
        orderBy: { order: "asc" },
        include: { tickets: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (!project) notFound();

  return (
    <div>
      <div className="board-header">
        <a href="/" className="subtle">
          ← Projects
        </a>
        <h1 className="page-title" style={{ margin: 0 }}>
          <span style={{ color: "var(--accent)" }}>{project.key}</span> {project.name}
        </h1>
      </div>

      <Board
        projectId={project.id}
        initialColumns={project.columns.map((c) => ({
          id: c.id,
          name: c.name,
          order: c.order,
          tickets: c.tickets.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            order: t.order,
            columnId: t.columnId,
          })),
        }))}
      />
    </div>
  );
}
