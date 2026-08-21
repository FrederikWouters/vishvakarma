import { prisma } from "@/lib/db";
import SettingsClient from "@/components/SettingsClient";

export default async function SettingsPage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      columns: {
        orderBy: { order: "asc" },
        include: { _count: { select: { tickets: true } } },
      },
      labels: { orderBy: { name: "asc" } },
    },
  });

  const data = projects.map((p) => ({
    id: p.id,
    name: p.name,
    key: p.key,
    columns: p.columns.map((c) => ({
      id: c.id,
      name: c.name,
      board: c.board,
      order: c.order,
      ticketCount: c._count.tickets,
    })),
    labels: p.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
  }));

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      {data.length === 0 ? (
        <p className="subtle">No projects yet. Create one from the home page first.</p>
      ) : (
        <SettingsClient projects={data} />
      )}
    </div>
  );
}
