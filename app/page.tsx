import { prisma } from "@/lib/db";
import NewProjectForm from "@/components/NewProjectForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { columns: true } } },
  });

  return (
    <div>
      <h1 className="page-title">Projects</h1>
      <p className="subtle">Create a project, then open its board to manage tickets across swimlanes.</p>

      <NewProjectForm />

      {projects.length === 0 ? (
        <p className="subtle" style={{ marginTop: 24 }}>
          No projects yet. Create one above.
        </p>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <a key={p.id} href={`/projects/${p.id}/board/analysis`} className="project-card">
              <div className="name">{p.name}</div>
              <div className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
                {p._count.columns} columns
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
