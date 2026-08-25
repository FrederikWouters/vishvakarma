import { prisma } from "@/lib/db";
import SettingsClient from "@/components/SettingsClient";
import { resolveInitialProject } from "@/lib/settingsProject";

// `searchParams` is async in the App Router (Next 15). A `?project=<id>` param
// (from a "Manage labels" link on a ticket) pre-scopes Settings to that
// project instead of the newest one (VSK-28).
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: requestedProject } = await searchParams;
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

  const initialProjectId = resolveInitialProject(data, requestedProject);

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      {data.length === 0 ? (
        <p className="subtle">No projects yet. Create one from the home page first.</p>
      ) : (
        <SettingsClient projects={data} initialProjectId={initialProjectId} />
      )}
    </div>
  );
}
