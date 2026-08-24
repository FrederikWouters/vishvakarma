/**
 * VSK-36 — one-shot data copy from the legacy SQLite board (prisma/dev.db)
 * into the hosted Postgres database.
 *
 * Copies every Project, Column, Label, Ticket and Label<->Ticket link in
 * foreign-key order, preserving each row's id, per-project `number`, `order`,
 * `board` and `createdAt` exactly, so KEY-NNN references and lane layout are
 * identical after the move.
 *
 * Idempotent: every row is upserted by primary key and label links are `set`
 * (not appended), so re-running against a partially-migrated target converges
 * to the same state without duplicates or unique-constraint violations. The
 * target is NOT truncated first (safe to run against a DB that already holds
 * the data).
 *
 * Usage (target = whatever DATABASE_URL points at — must be Postgres):
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-postgres.ts [path/to/dev.db]
 *
 * SQLite is read with the built-in node:sqlite reader (no extra dependency);
 * Prisma writes to Postgres. This sidesteps Prisma's single-provider limit.
 */
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface MigrationReport {
  projects: { source: number; target: number };
  columns: { source: number; target: number };
  labels: { source: number; target: number };
  tickets: { source: number; target: number };
  links: { source: number; target: number };
}

type SqliteDate = number | bigint | string;
interface ProjectRow { id: string; name: string; key: string; createdAt: SqliteDate }
interface ColumnRow { id: string; name: string; board: string; order: number; projectId: string }
interface LabelRow { id: string; name: string; color: string; projectId: string }
interface TicketRow {
  id: string; title: string; description: string | null; order: number;
  number: number; columnId: string; projectId: string; createdAt: SqliteDate;
}
interface LinkRow { A: string; B: string } // A = Label.id, B = Ticket.id

/**
 * Convert a SQLite `createdAt` to a Date. Prisma+SQLite stores DateTime as
 * epoch-ms INTEGER, but some rows in dev.db are TEXT ("YYYY-MM-DD HH:MM:SS",
 * UTC — e.g. from CURRENT_TIMESTAMP). JS would parse that space-separated form
 * as LOCAL time; make UTC explicit so timestamps don't drift by the offset.
 */
function toDate(v: SqliteDate): Date {
  let d: Date;
  if (typeof v === "string") {
    const s = v.trim();
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)
      ? s.replace(" ", "T") + "Z"
      : s;
    d = new Date(iso);
  } else {
    d = new Date(Number(v));
  }
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unparseable createdAt value: ${JSON.stringify(v)}`);
  }
  return d;
}

/**
 * Copy all board data from the SQLite file at `sqlitePath` into the Postgres
 * database behind `prisma`. Returns per-entity source/target counts (scoped to
 * the projects present in the source) for verification.
 */
export async function migrateData(
  sqlitePath: string,
  prisma: PrismaClient
): Promise<MigrationReport> {
  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite source not found: ${sqlitePath}`);
  }
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const projects = db.prepare("select id, name, key, createdAt from Project").all() as unknown as ProjectRow[];
    const columns = db.prepare('select id, name, board, "order", projectId from "Column"').all() as unknown as ColumnRow[];
    const labels = db.prepare("select id, name, color, projectId from Label").all() as unknown as LabelRow[];
    const tickets = db.prepare('select id, title, description, "order", number, columnId, projectId, createdAt from Ticket').all() as unknown as TicketRow[];
    const links = db.prepare('select "A", "B" from "_LabelToTicket"').all() as unknown as LinkRow[];

    // Label ids per ticket, for the implicit many-to-many `set`.
    const labelsByTicket = new Map<string, string[]>();
    for (const { A: labelId, B: ticketId } of links) {
      const arr = labelsByTicket.get(ticketId) ?? [];
      arr.push(labelId);
      labelsByTicket.set(ticketId, arr);
    }

    // FK order: Project -> Column -> Label -> Ticket (+ links via set).
    for (const p of projects) {
      const data = { name: p.name, key: p.key, createdAt: toDate(p.createdAt) };
      await prisma.project.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
    }
    for (const c of columns) {
      const data = { name: c.name, board: c.board, order: c.order, projectId: c.projectId };
      await prisma.column.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
    }
    for (const l of labels) {
      const data = { name: l.name, color: l.color, projectId: l.projectId };
      await prisma.label.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data });
    }
    for (const t of tickets) {
      const labelIds = (labelsByTicket.get(t.id) ?? []).map((id) => ({ id }));
      const data = {
        title: t.title,
        description: t.description,
        order: t.order,
        number: t.number,
        columnId: t.columnId,
        projectId: t.projectId,
        createdAt: toDate(t.createdAt),
      };
      await prisma.ticket.upsert({
        where: { id: t.id },
        // `connect` on create (no existing links); `set` on update makes the
        // link set idempotent by replacing rather than appending.
        create: { id: t.id, ...data, labels: { connect: labelIds } },
        update: { ...data, labels: { set: labelIds } },
      });
    }

    // Verify: counts scoped to the projects we copied.
    const projectIds = projects.map((p) => p.id);
    const scope = { projectId: { in: projectIds } };
    const [tProjects, tColumns, tLabels, tTickets] = await Promise.all([
      prisma.project.count({ where: { id: { in: projectIds } } }),
      prisma.column.count({ where: scope }),
      prisma.label.count({ where: scope }),
      prisma.ticket.count({ where: scope }),
    ]);
    const tLinks = (
      await prisma.ticket.findMany({
        where: scope,
        select: { _count: { select: { labels: true } } },
      })
    ).reduce((sum, t) => sum + t._count.labels, 0);

    return {
      projects: { source: projects.length, target: tProjects },
      columns: { source: columns.length, target: tColumns },
      labels: { source: labels.length, target: tLabels },
      tickets: { source: tickets.length, target: tTickets },
      links: { source: links.length, target: tLinks },
    };
  } finally {
    db.close();
  }
}

// CLI wrapper. Skipped when imported (e.g. by tests).
const isMain = process.argv[1] && resolve(process.argv[1]).endsWith("migrate-sqlite-to-postgres.ts");
if (isMain) {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error(`Refusing to run: DATABASE_URL must be a Postgres URL, got: ${url || "<unset>"}`);
    process.exit(1);
  }
  const sqlitePath = process.argv[2] ?? resolve(process.cwd(), "prisma/dev.db");
  const prisma = new PrismaClient();
  migrateData(sqlitePath, prisma)
    .then((report) => {
      console.log("Data migration complete. Source -> target row counts:");
      let ok = true;
      for (const [entity, { source, target }] of Object.entries(report)) {
        const match = source === target;
        ok &&= match;
        console.log(`  ${entity.padEnd(9)} ${source} -> ${target} ${match ? "OK" : "MISMATCH"}`);
      }
      if (!ok) {
        console.error("Row counts do not match; investigate before cutover.");
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error("Data migration failed:", err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
