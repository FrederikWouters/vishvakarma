import { PrismaClient } from "@prisma/client";

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
        create: [
          { name: "To Do", order: 0 },
          { name: "In Progress", order: 1 },
          { name: "Done", order: 2 },
        ],
      },
    },
    include: { columns: { orderBy: { order: "asc" } } },
  });

  const [todo, doing] = project.columns;

  await prisma.ticket.createMany({
    data: [
      { columnId: todo.id, title: "Set up project board", order: 0, description: "Swimlanes + tickets" },
      { columnId: todo.id, title: "Add drag-and-drop", order: 1 },
      { columnId: doing.id, title: "Design data model", order: 0, description: "Project / Column / Ticket" },
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
