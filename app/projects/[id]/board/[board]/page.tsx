import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Board from "@/components/Board";
import { boardLabel, isBoardSlug } from "@/lib/boards";

// Render on every request: the board is also written out-of-band by
// scripts/board.ts (direct DB), which never triggers revalidatePath, so a
// cached page would show stale data until a redeploy (VSK-38).
export const revalidate = 0;

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string; board: string }>;
}) {
  const { id, board } = await params;
  if (!isBoardSlug(board)) notFound();

  // These two reads are independent (the sequence keys off the route `id`, not
  // the fetched project), so run them in parallel: on serverless against a
  // networked Postgres (Neon) every serial query adds a full round-trip of
  // latency to the board render. One Promise.all removes that waterfall.
  const [project, sequence] = await Promise.all([
    prisma.project.findUnique({
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
    }),
    // Full ordered column sequence across every board, so "Advance" can move a
    // ticket into the next column even when it lives on a different board.
    prisma.column.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, board: true },
    }),
  ]);

  if (!project) notFound();

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
