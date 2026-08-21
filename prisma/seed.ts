import { PrismaClient } from "@prisma/client";
import { DEFAULT_COLUMNS } from "../lib/boards";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.project.findUnique({ where: { key: "VSK" } });
  if (existing) {
    console.log("Seed skipped: VSK project already exists");
    return;
  }

  const project = await prisma.project.create({
    data: {
      name: "Vishvakarma Core",
      key: "VSK",
      columns: {
        create: DEFAULT_COLUMNS.map((c, i) => ({ name: c.name, board: c.board, order: i })),
      },
    },
    include: { columns: { orderBy: { order: "asc" } } },
  });

  const open = project.columns.find((c) => c.name === "Open")!;
  const developing = project.columns.find((c) => c.name === "Developing")!;

  // number is per-project sequential; projectId is required — both were added
  // by the VSK-8 migration and must be set here.
  await prisma.ticket.createMany({
    data: [
      {
        columnId: open.id,
        projectId: project.id,
        number: 1,
        order: 0,
        title: "Set up project board",
        description: "Swimlanes + tickets",
      },
      {
        columnId: open.id,
        projectId: project.id,
        number: 2,
        order: 1,
        title: "Add drag-and-drop",
      },
      {
        columnId: developing.id,
        projectId: project.id,
        number: 3,
        order: 0,
        title: "Design data model",
        description: "Project / Column / Ticket",
      },
    ],
  });

  console.log("Seeded project VSK with sample tickets");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
