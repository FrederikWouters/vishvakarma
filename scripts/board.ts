#!/usr/bin/env -S npx tsx
/**
 * Create or edit Vishvakarma tickets on the HOSTED board (Neon Postgres).
 *
 * VSK-38 cutover: replaces the old scripts/board.py, which wrote the retired
 * local SQLite prisma/dev.db. This tool talks to whatever DATABASE_URL points
 * at — set it to the live Neon connection string (pooled) in a gitignored
 * repo-root .env so board reads/writes hit the live board, never local dev.db.
 *
 * It uses the same Prisma client the app uses, so ids (cuid) and createdAt
 * (now()) are generated exactly as the app generates them; this script only
 * supplies the per-project `number` and the in-column `order`.
 *
 * Usage:
 *   npx tsx scripts/board.ts create --project VSK --title "..." \
 *       [--description "..."] [--column Open]
 *   npx tsx scripts/board.ts edit VSK-12 [--title "..."] \
 *       [--description "..."] [--column Developing]
 *   npx tsx scripts/board.ts list [--project VSK]   # read the live board
 *
 * `--column` takes a column NAME (unique per project, e.g. Open, Developing,
 * Closed). On create it defaults to "Open". On edit, giving --column MOVES the
 * ticket to that column (i.e. changes its status). Tickets are referenced as
 * KEY-NUMBER (e.g. VSK-12).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load DATABASE_URL from a gitignored repo-root .env if it isn't already set
// (tsx does not auto-load .env; the app relies on the Prisma CLI / Vercel).
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = resolve(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadEnv();

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  die(
    "error: DATABASE_URL is not set. Put the live Neon (pooled) connection " +
      "string in a gitignored repo-root .env as DATABASE_URL, or pass it " +
      "inline: DATABASE_URL=... npx tsx scripts/board.ts ...",
  );
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  die(
    `error: DATABASE_URL must be a Postgres URL for the hosted board (got ${url.slice(0, 12)}...). ` +
      "The local SQLite board is retired.",
  );
}

// The datasource URL is read when the client is instantiated (here), which
// runs after loadEnv() above — so DATABASE_URL from .env is already in place.
const prisma = new PrismaClient();

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Minimal flag parser: --key value (and bare positional args). */
function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        die(`error: flag --${key} needs a value`);
      }
      flags[key] = next;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function findProject(key: string) {
  const p = await prisma.project.findUnique({
    where: { key: key.toUpperCase() },
  });
  if (!p) die(`error: no project with key '${key.toUpperCase()}'`);
  return p;
}

async function findColumn(projectId: string, name: string) {
  const col = await prisma.column.findFirst({
    where: { projectId, name: { equals: name, mode: "insensitive" } },
  });
  if (!col) die(`error: no column named '${name}' in this project`);
  return col;
}

async function nextNumber(projectId: string) {
  const agg = await prisma.ticket.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  return (agg._max.number ?? 0) + 1;
}

async function nextOrder(columnId: string) {
  const agg = await prisma.ticket.aggregate({
    where: { columnId },
    _max: { order: true },
  });
  return (agg._max.order ?? -1) + 1;
}

async function cmdCreate(flags: Record<string, string>) {
  if (!flags.project) die("error: create needs --project KEY");
  if (!flags.title) die("error: create needs --title");
  const proj = await findProject(flags.project);
  const col = await findColumn(proj.id, flags.column ?? "Open");

  // Bounded retry on the per-project number race (mirrors the app's VSK-32 fix),
  // in case two board writers run at once.
  for (let attempt = 0; attempt < 25; attempt++) {
    const number = await nextNumber(proj.id);
    const order = await nextOrder(col.id);
    try {
      await prisma.ticket.create({
        data: {
          title: flags.title,
          description: flags.description ?? null,
          order,
          number,
          columnId: col.id,
          projectId: proj.id,
        },
      });
      console.log(
        `created ${proj.key}-${number}  [${col.board}/${col.name}]  ${flags.title}`,
      );
      return;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        continue; // number was taken concurrently — re-read max and retry
      }
      throw e;
    }
  }
  die("error: could not allocate a ticket number after 25 attempts");
}

async function cmdEdit(positional: string[], flags: Record<string, string>) {
  const ref = positional[0];
  if (!ref) die("error: edit needs a ticket ref, e.g. VSK-12");
  const m = /^([A-Za-z]+)-(\d+)$/.exec(ref.trim());
  if (!m) die(`error: ticket ref must be KEY-NUMBER (e.g. VSK-12), got '${ref}'`);
  const proj = await findProject(m[1]);
  const number = Number(m[2]);
  const ticket = await prisma.ticket.findFirst({
    where: { projectId: proj.id, number },
  });
  if (!ticket) die(`error: no ticket ${proj.key}-${number}`);

  const data: Record<string, unknown> = {};
  const notes: string[] = [];
  if (flags.title !== undefined) {
    data.title = flags.title;
    notes.push("title");
  }
  if (flags.description !== undefined) {
    data.description = flags.description;
    notes.push("description");
  }
  if (flags.column !== undefined) {
    const col = await findColumn(proj.id, flags.column);
    data.columnId = col.id;
    data.order = await nextOrder(col.id);
    notes.push(`moved to ${col.board}/${col.name}`);
  }
  if (notes.length === 0) {
    die("error: nothing to edit (give --title, --description, and/or --column)");
  }
  await prisma.ticket.update({ where: { id: ticket.id }, data });
  console.log(`edited ${proj.key}-${number}  (${notes.join("; ")})`);
}

async function cmdList(flags: Record<string, string>) {
  const rows = await prisma.ticket.findMany({
    where: flags.project
      ? { project: { key: flags.project.toUpperCase() } }
      : undefined,
    select: {
      number: true,
      title: true,
      project: { select: { key: true } },
      column: { select: { name: true, board: true, order: true } },
    },
    orderBy: [
      { project: { key: "asc" } },
      { column: { order: "asc" } },
      { order: "asc" },
    ],
  });
  for (const r of rows) {
    const ref = `${r.project.key}-${r.number}`.padEnd(7);
    console.log(
      `${ref}| ${r.column.board.padEnd(11)}| ${r.column.name.padEnd(11)}| ${r.title}`,
    );
  }
}

async function cmdShow(positional: string[]) {
  const ref = positional[0];
  if (!ref) die("error: show needs a ticket ref, e.g. VSK-12");
  const m = /^([A-Za-z]+)-(\d+)$/.exec(ref.trim());
  if (!m) die(`error: ticket ref must be KEY-NUMBER (e.g. VSK-12), got '${ref}'`);
  const proj = await findProject(m[1]);
  const t = await prisma.ticket.findFirst({
    where: { projectId: proj.id, number: Number(m[2]) },
    include: { column: true, labels: { select: { name: true } } },
  });
  if (!t) die(`error: no ticket ${proj.key}-${m[2]}`);
  console.log(`${proj.key}-${t.number}  [${t.column.board}/${t.column.name}]  ${t.title}`);
  const labels = t.labels.map((l) => l.name).join(", ");
  if (labels) console.log(`labels: ${labels}`);
  console.log("---");
  console.log(t.description ?? "(no description)");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseArgs(rest);
  if (cmd === "create") await cmdCreate(flags);
  else if (cmd === "edit") await cmdEdit(positional, flags);
  else if (cmd === "list") await cmdList(flags);
  else if (cmd === "show") await cmdShow(positional);
  else
    die(
      "usage: npx tsx scripts/board.ts {create|edit|list|show} ...\n" +
        "  create --project VSK --title '...' [--description '...'] [--column Open]\n" +
        "  edit VSK-12 [--title '...'] [--description '...'] [--column Developing]\n" +
        "  list [--project VSK]\n" +
        "  show VSK-12",
    );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
