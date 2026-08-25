import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { revalidateBoards, revalidateSettings } from "@/lib/revalidate";

// The per-project ticket number is derived from the current max and written
// under the @@unique([projectId, number]) constraint. On Postgres READ
// COMMITTED (unlike SQLite's single-writer lock, which serialized writers and
// masked this) two concurrent creates can read the same max, compute the same
// number, and collide — Prisma raises P2002. Ticket has exactly ONE unique
// index, [projectId, number], so a P2002 here is always that lost race. We let
// the unique index be the source of truth: on collision, re-read the (now
// higher, committed) max and retry. Each committed insert advances the max by
// exactly 1 and a rejected insert commits nothing, so numbers stay unique AND
// gapless. The loop is bounded well above any realistic concurrency; exhausting
// it rethrows (surfacing a 500) rather than looping forever.
//
// Trade-off: a bounded retry loop (pure Prisma, no raw SQL — preserves this
// codebase's no-raw-SQL invariant) over a Postgres advisory lock or SERIALIZABLE
// isolation. For a single-user board real concurrent creation is near-zero, so
// retries almost never fire; the advisory-lock alternative only wins under
// sustained high-concurrency writes this app does not have, and it would cost a
// $executeRaw escape hatch plus a projectId->bigint hash.
const MAX_CREATE_ATTEMPTS = 50;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const columnId = typeof body?.columnId === "string" ? body.columnId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const description =
    typeof body?.description === "string" ? body.description.trim() || null : null;
  const order = Number.isInteger(body?.order) ? body.order : 0;

  if (!columnId || !title) {
    return NextResponse.json({ error: "columnId and title are required" }, { status: 400 });
  }
  if (title.length > LIMITS.ticketTitle) {
    return NextResponse.json(
      { error: `Title must be ${LIMITS.ticketTitle} characters or fewer` },
      { status: 400 }
    );
  }
  if (description && description.length > LIMITS.ticketDescription) {
    return NextResponse.json(
      { error: `Description is too long (max ${LIMITS.ticketDescription} characters)` },
      { status: 400 }
    );
  }

  const column = await prisma.column.findUnique({ where: { id: columnId } });
  if (!column) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  // Assign the next per-project ticket number, retrying on the unique-constraint
  // collision two concurrent creates can hit under Postgres READ COMMITTED
  // (see the note above MAX_CREATE_ATTEMPTS).
  for (let attempt = 1; ; attempt++) {
    try {
      const ticket = await prisma.$transaction(async (tx) => {
        const last = await tx.ticket.findFirst({
          where: { projectId: column.projectId },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const number = (last?.number ?? 0) + 1;
        return tx.ticket.create({
          data: { columnId, projectId: column.projectId, title, description, order, number },
        });
      });

      revalidateBoards();
      revalidateSettings();
      return NextResponse.json(ticket, { status: 201 });
    } catch (err) {
      const isNumberRace =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (isNumberRace && attempt < MAX_CREATE_ATTEMPTS) continue;
      throw err;
    }
  }
}
