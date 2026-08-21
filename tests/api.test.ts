import { describe, it, expect, vi } from "vitest";

// revalidatePath only works inside a Next request context; stub it for tests.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { POST as createTicket } from "@/app/api/tickets/route";
import { PATCH as reorder } from "@/app/api/tickets/reorder/route";
import { DELETE as deleteColumn } from "@/app/api/columns/[id]/route";

function post(body: unknown) {
  return new Request("http://test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function freshProject(key: string) {
  return prisma.project.create({
    data: {
      name: key,
      key,
      columns: { create: [{ name: "Open", board: "analysis", order: 0 }] },
    },
    include: { columns: true },
  });
}

describe("POST /api/tickets — per-project number assignment", () => {
  it("assigns sequential numbers starting at 1", async () => {
    const p = await freshProject("TN");
    const col = p.columns[0];
    const first = await (await createTicket(post({ columnId: col.id, title: "A" }))).json();
    const second = await (await createTicket(post({ columnId: col.id, title: "B" }))).json();
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
  });
});

describe("DELETE /api/columns/[id] — guard when column has tickets", () => {
  it("returns 409 while tickets remain", async () => {
    const p = await freshProject("DG");
    const col = p.columns[0];
    await prisma.ticket.create({
      data: { columnId: col.id, projectId: p.id, number: 1, order: 0, title: "x" },
    });
    const res = await deleteColumn(new Request("http://test", { method: "DELETE" }), {
      params: Promise.resolve({ id: col.id }),
    });
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/tickets/reorder — reindexes a lane", () => {
  it("rewrites order to a clean 0..n in the given sequence", async () => {
    const p = await freshProject("RE");
    const col = p.columns[0];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await prisma.ticket.create({
        data: { columnId: col.id, projectId: p.id, number: i + 1, order: 5, title: `t${i}` },
      });
      ids.push(t.id);
    }
    const reversed = [...ids].reverse();
    const res = await reorder(post({ columnId: col.id, orderedIds: reversed }));
    expect(res.status).toBe(200);
    const rows = await prisma.ticket.findMany({
      where: { columnId: col.id },
      orderBy: { order: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual(reversed);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });
});
