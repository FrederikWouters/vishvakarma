// One-off, idempotent backfill: ensure every project has a "Cancelled" column
// on the acceptance board. Skips projects that already have one (e.g. GAN).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    include: { columns: { orderBy: { order: "asc" } } },
  });

  for (const project of projects) {
    const has = project.columns.some(
      (c) => c.name.toLowerCase() === "cancelled"
    );
    if (has) {
      console.log(`${project.key}: already has Cancelled — skipped`);
      continue;
    }
    const maxOrder = Math.max(...project.columns.map((c) => c.order), -1);
    await prisma.column.create({
      data: {
        name: "Cancelled",
        board: "acceptance",
        order: maxOrder + 1,
        projectId: project.id,
      },
    });
    console.log(`${project.key}: created Cancelled at order ${maxOrder + 1}`);
  }
}

main()
  .then(() => console.log("done"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
