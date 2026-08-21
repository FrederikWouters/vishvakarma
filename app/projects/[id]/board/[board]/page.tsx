import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Board from "@/components/Board";
import { boardLabel, isBoardSlug } from "@/lib/boards";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string; board: string }>;
}) {
  const { id, board } = await params;
  if (!isBoardSlug(board)) notFound();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      columns: {
        where: { board },
        orderBy: { order: "asc" },
        include: {
          tickets: {
            orderBy: { order: "asc" },
            include: { labels: { orderBy: { name: "asc" } } },
          },
        },
      },
    },
  });

  if (!project) notFound();

  // Full ordered column sequence across every board, so "Advance" can move a
  // ticket into the next column even when it lives on a different board.
  const sequence = await prisma.column.findMany({
    where: { projectId: id },
    orderBy: { order: "asc" },
    select: { id: true, name: true, board: true },
  });

  return (
    <div>
      <div className="board-header">
        <h1 className="page-title" style={{ margin: 0 }}>
          {project.name}
        </h1>
        <span className="subtle">/ {boardLabel(board)}</span>
      </div>

      {project.columns.length === 0 ? (
        <p className="subtle" style={{ marginTop: 16 }}>
          No columns on this board.
        </p>
      ) : (
        <Board
          projectId={project.id}
          projectKey={project.key}
          board={board}
          sequence={sequence}
          initialColumns={project.columns.map((c) => ({
            id: c.id,
            name: c.name,
            order: c.order,
            tickets: c.tickets.map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              order: t.order,
              number: t.number,
              columnId: t.columnId,
              labels: t.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
            })),
          }))}
        />
      )}
    </div>
  );
}
