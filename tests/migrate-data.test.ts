import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { migrateData } from "@/scripts/migrate-sqlite-to-postgres";

// Build a throwaway SQLite file shaped exactly like prisma/dev.db (the columns
// the copy script reads), with a self-contained project so assertions can be
// scoped and never collide with other tests' data.
const KEY = "MIGP";
const CREATED = 1787080389906; // epoch ms, as SQLite/Prisma store DateTime
let dir: string;
let dbPath: string;

const ids = {
  project: "cmig_project_0000000000",
  colOpen: "cmig_col_open_000000000",
  colDev: "cmig_col_dev_0000000000",
  label1: "cmig_label_1_0000000000",
  label2: "cmig_label_2_0000000000",
  t1: "cmig_ticket_1_000000000",
  t2: "cmig_ticket_2_000000000",
  t3: "cmig_ticket_3_000000000",
};

function buildFixture(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE "Project" (id TEXT PRIMARY KEY, name TEXT, key TEXT, createdAt DATETIME);
    CREATE TABLE "Column" (id TEXT PRIMARY KEY, name TEXT, board TEXT, "order" INTEGER, projectId TEXT);
    CREATE TABLE "Label" (id TEXT PRIMARY KEY, name TEXT, color TEXT, projectId TEXT);
    CREATE TABLE "Ticket" (id TEXT PRIMARY KEY, title TEXT, description TEXT, "order" INTEGER, number INTEGER, columnId TEXT, projectId TEXT, createdAt DATETIME);
    CREATE TABLE "_LabelToTicket" (A TEXT, B TEXT);
  `);
  db.prepare('INSERT INTO "Project" VALUES (?,?,?,?)').run(ids.project, "Migrate Test", KEY, CREATED);
  db.prepare('INSERT INTO "Column" VALUES (?,?,?,?,?)').run(ids.colOpen, "Open", "analysis", 0, ids.project);
  db.prepare('INSERT INTO "Column" VALUES (?,?,?,?,?)').run(ids.colDev, "Developing", "development", 1, ids.project);
  db.prepare('INSERT INTO "Label" VALUES (?,?,?,?)').run(ids.label1, "bug", "#ff0000", ids.project);
  db.prepare('INSERT INTO "Label" VALUES (?,?,?,?)').run(ids.label2, "chore", "#00ff00", ids.project);
  // t1: order 5 (not 0 -> proves order is preserved, not reindexed), two labels
  db.prepare('INSERT INTO "Ticket" VALUES (?,?,?,?,?,?,?,?)').run(ids.t1, "First", "<p>desc</p>", 5, 1, ids.colOpen, ids.project, CREATED);
  db.prepare('INSERT INTO "Ticket" VALUES (?,?,?,?,?,?,?,?)').run(ids.t2, "Second", null, 0, 2, ids.colDev, ids.project, CREATED + 1000);
  // t3 stores createdAt as a SQLite TEXT datetime (UTC), like CURRENT_TIMESTAMP
  // rows in the real dev.db — must be read as UTC, not local time.
  db.prepare('INSERT INTO "Ticket" VALUES (?,?,?,?,?,?,?,?)').run(ids.t3, "Third", null, 1, 3, ids.colDev, ids.project, "2026-08-24 07:48:49");
  db.prepare('INSERT INTO "_LabelToTicket" VALUES (?,?)').run(ids.label1, ids.t1);
  db.prepare('INSERT INTO "_LabelToTicket" VALUES (?,?)').run(ids.label2, ids.t1);
  db.prepare('INSERT INTO "_LabelToTicket" VALUES (?,?)').run(ids.label1, ids.t2);
  db.close();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vsk-migrate-"));
  dbPath = join(dir, "dev.db");
  buildFixture(dbPath);
});

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { project: { key: KEY } } });
  await prisma.label.deleteMany({ where: { project: { key: KEY } } });
  await prisma.column.deleteMany({ where: { project: { key: KEY } } });
  await prisma.project.deleteMany({ where: { key: KEY } });
  rmSync(dir, { recursive: true, force: true });
});

describe("migrateData — SQLite -> Postgres copy (VSK-36)", () => {
  it("copies every row with matching source/target counts", async () => {
    const report = await migrateData(dbPath, prisma);
    expect(report.projects).toEqual({ source: 1, target: 1 });
    expect(report.columns).toEqual({ source: 2, target: 2 });
    expect(report.labels).toEqual({ source: 2, target: 2 });
    expect(report.tickets).toEqual({ source: 3, target: 3 });
    expect(report.links).toEqual({ source: 3, target: 3 });
  });

  it("preserves id, number, order, board, createdAt and label set", async () => {
    await migrateData(dbPath, prisma);
    const t1 = await prisma.ticket.findUnique({
      where: { id: ids.t1 },
      include: { labels: true, column: true },
    });
    expect(t1).not.toBeNull();
    expect(t1!.number).toBe(1);
    expect(t1!.order).toBe(5); // preserved, not reindexed to 0
    expect(t1!.createdAt.getTime()).toBe(CREATED);
    expect(t1!.column.board).toBe("analysis");
    expect(t1!.labels.map((l) => l.id).sort()).toEqual([ids.label1, ids.label2].sort());

    const project = await prisma.project.findUnique({ where: { key: KEY } });
    expect(project!.id).toBe(ids.project);
    expect(project!.createdAt.getTime()).toBe(CREATED);

    // TEXT datetime is read as UTC (not local), so no timezone drift.
    const t3 = await prisma.ticket.findUnique({ where: { id: ids.t3 } });
    expect(t3!.createdAt.toISOString()).toBe("2026-08-24T07:48:49.000Z");
  });

  it("is idempotent: a second run produces no duplicates or constraint errors", async () => {
    await migrateData(dbPath, prisma);
    const report = await migrateData(dbPath, prisma);
    expect(report.tickets).toEqual({ source: 3, target: 3 });
    expect(report.links).toEqual({ source: 3, target: 3 });
    // Unique constraints hold: exactly one ticket per (projectId, number).
    const nums = await prisma.ticket.findMany({
      where: { project: { key: KEY } },
      select: { number: true },
      orderBy: { number: "asc" },
    });
    expect(nums.map((n) => n.number)).toEqual([1, 2, 3]);
  });
});
