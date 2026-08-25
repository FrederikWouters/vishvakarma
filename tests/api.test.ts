import { describe, it, expect, vi } from "vitest";

// revalidatePath only works inside a Next request context; stub it for tests.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { POST as createTicket } from "@/app/api/tickets/route";
import { PATCH as reorder } from "@/app/api/tickets/reorder/route";
import { PATCH as patchTicket } from "@/app/api/tickets/[id]/route";
import { DELETE as deleteColumn } from "@/app/api/columns/[id]/route";
import { GET as getLabels, POST as createLabel } from "@/app/api/labels/route";

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

describe("POST /api/tickets — concurrent creates (VSK-32 regression)", () => {
  it("gives N racing creates unique, gapless numbers 1..N with no failure", async () => {
    const p = await freshProject("CC");
    const col = p.columns[0];
    const N = 20;

    // Fire N creates on one fresh project simultaneously. Under Postgres READ
    // COMMITTED the naive max()+1 read races and collides on
    // @@unique([projectId, number]); the route must retry so every one lands.
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        createTicket(post({ columnId: col.id, title: `c${i}` }))
      )
    );

    // No request may throw (a throw = 500 in Next = lost ticket) and each must
    // return 201.
    type CreateResult = Awaited<ReturnType<typeof createTicket>>;
    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<CreateResult> => r.status === "fulfilled"
    );
    expect(fulfilled.length).toBe(N);
    expect(fulfilled.map((r) => r.value.status)).toEqual(Array(N).fill(201));

    // The persisted numbers are exactly the contiguous set 1..N (unique, no gaps).
    const rows = await prisma.ticket.findMany({
      where: { projectId: p.id },
      orderBy: { number: "asc" },
      select: { number: true },
    });
    expect(rows.map((r) => r.number)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1)
    );
  });
});

describe("POST /api/tickets — description length cap (VSK-22)", () => {
  it("rejects a description over LIMITS.ticketDescription with 400 and stores nothing", async () => {
    const p = await freshProject("DC");
    const col = p.columns[0];
    const before = await prisma.ticket.count({ where: { columnId: col.id } });
    const res = await createTicket(
      post({ columnId: col.id, title: "ok", description: "a".repeat(LIMITS.ticketDescription + 1) })
    );
    expect(res.status).toBe(400);
    const after = await prisma.ticket.count({ where: { columnId: col.id } });
    expect(after).toBe(before);
  });

  it("accepts a description at exactly the cap with 201", async () => {
    const p = await freshProject("DA");
    const col = p.columns[0];
    const res = await createTicket(
      post({ columnId: col.id, title: "ok", description: "a".repeat(LIMITS.ticketDescription) })
    );
    expect(res.status).toBe(201);
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

describe("PATCH /api/tickets/reorder — diff-only writes (VSK-24)", () => {
  it("writes only the rows whose order actually changed", async () => {
    const p = await freshProject("DF");
    const col = p.columns[0];
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = await prisma.ticket.create({
        data: { columnId: col.id, projectId: p.id, number: i + 1, order: i, title: `t${i}` },
      });
      ids.push(t.id);
    }
    // Swap the first two cards; the other three keep their order.
    const reordered = [ids[1], ids[0], ids[2], ids[3], ids[4]];
    const res = await reorder(post({ columnId: col.id, orderedIds: reordered }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.written).toBe(2);
    const rows = await prisma.ticket.findMany({
      where: { columnId: col.id },
      orderBy: { order: "asc" },
    });
    expect(rows.map((r) => r.id)).toEqual(reordered);
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("issues zero writes when the requested order matches the stored order", async () => {
    const p = await freshProject("NW");
    const col = p.columns[0];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = await prisma.ticket.create({
        data: { columnId: col.id, projectId: p.id, number: i + 1, order: i, title: `t${i}` },
      });
      ids.push(t.id);
    }
    const res = await reorder(post({ columnId: col.id, orderedIds: ids }));
    const json = await res.json();
    expect(json.written).toBe(0);
  });
});

describe("PATCH /api/tickets/reorder — full-column reindex (VSK-24)", () => {
  it("reindexes the whole column and cleans duplicate/gappy orders even from a partial-lane call", async () => {
    const p = await freshProject("PL");
    const col = p.columns[0];
    // Deliberately messy: two rows share order 0, one is gapped at 5.
    const a = await prisma.ticket.create({
      data: { columnId: col.id, projectId: p.id, number: 1, order: 0, title: "a" },
    });
    const b = await prisma.ticket.create({
      data: { columnId: col.id, projectId: p.id, number: 2, order: 0, title: "b" },
    });
    const c = await prisma.ticket.create({
      data: { columnId: col.id, projectId: p.id, number: 3, order: 5, title: "c" },
    });
    // Caller names only a subset (c, a); b is omitted but must not be stranded.
    const res = await reorder(post({ columnId: col.id, orderedIds: [c.id, a.id] }));
    expect(res.status).toBe(200);
    const rows = await prisma.ticket.findMany({
      where: { columnId: col.id },
      orderBy: { order: "asc" },
    });
    // Listed ids first (in given order), the omitted extra appended after.
    expect(rows.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
    // Gapless 0..n, no duplicates.
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2]);
  });
});

describe("PATCH /api/tickets/reorder — cross-lane, diff-only (VSK-24)", () => {
  it("moves a ticket into the target column writing only the changed row", async () => {
    const p = await freshProject("XL");
    const colA = p.columns[0];
    const colB = await prisma.column.create({
      data: { name: "B", board: "analysis", order: 1, projectId: p.id },
    });
    const t0 = await prisma.ticket.create({
      data: { columnId: colB.id, projectId: p.id, number: 1, order: 0, title: "t0" },
    });
    const t1 = await prisma.ticket.create({
      data: { columnId: colB.id, projectId: p.id, number: 2, order: 1, title: "t1" },
    });
    const x = await prisma.ticket.create({
      data: { columnId: colA.id, projectId: p.id, number: 3, order: 0, title: "x" },
    });
    // Append x to the end of colB; t0/t1 keep their positions.
    const res = await reorder(post({ columnId: colB.id, orderedIds: [t0.id, t1.id, x.id] }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.written).toBe(1);
    const moved = await prisma.ticket.findUnique({ where: { id: x.id } });
    expect(moved?.columnId).toBe(colB.id);
    expect(moved?.order).toBe(2);
  });

  it("ignores stray ids that belong to another project", async () => {
    const p1 = await freshProject("S1");
    const p2 = await freshProject("S2");
    const col = p1.columns[0];
    const t = await prisma.ticket.create({
      data: { columnId: col.id, projectId: p1.id, number: 1, order: 0, title: "keep" },
    });
    const stray = await prisma.ticket.create({
      data: { columnId: p2.columns[0].id, projectId: p2.id, number: 1, order: 0, title: "stray" },
    });
    const res = await reorder(post({ columnId: col.id, orderedIds: [stray.id, t.id] }));
    expect(res.status).toBe(200);
    // The stray id was dropped; it stays in its own project's column.
    const strayRow = await prisma.ticket.findUnique({ where: { id: stray.id } });
    expect(strayRow?.columnId).toBe(p2.columns[0].id);
    const kept = await prisma.ticket.findUnique({ where: { id: t.id } });
    expect(kept?.columnId).toBe(col.id);
  });
});

describe("PATCH /api/tickets/[id] — failure signal the Board/modal surface (VSK-21)", () => {
  it("returns a non-ok status for a missing ticket so the client can alert & revert", async () => {
    const req = new Request("http://test/api/tickets/does-not-exist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    const res = await patchTicket(req, { params: Promise.resolve({ id: "does-not-exist" }) });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/tickets/[id] — server backstop for description HTML (VSK-26)", () => {
  async function saveDescription(description: string) {
    const p = await freshProject("SB" + Math.random().toString(36).slice(2, 6).toUpperCase());
    const t = await prisma.ticket.create({
      data: { columnId: p.columns[0].id, projectId: p.id, number: 1, order: 0, title: "x" },
    });
    const req = new Request(`http://test/api/tickets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const res = await patchTicket(req, { params: Promise.resolve({ id: t.id }) });
    expect(res.ok).toBe(true);
    return (await res.json()).description as string | null;
  }

  it("preserves the new table and details tags (regex backstop leaves them intact)", async () => {
    const html =
      "<details><summary>TA</summary><p>hidden</p></details>" +
      "<table><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>";
    expect(await saveDescription(html)).toBe(html);
  });

  it("strips a <script> block, an onclick handler and a javascript: URL", async () => {
    const out = await saveDescription(
      '<p onclick="steal()">x</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>'
    );
    expect(out).not.toMatch(/<script|onclick|javascript:/i);
  });
});

describe("GET/POST /api/labels — labels are scoped per project (VSK-28)", () => {
  function labelPost(body: unknown) {
    return new Request("http://test/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function labelsFor(projectId: string) {
    const res = await getLabels(
      new Request(`http://test/api/labels?projectId=${projectId}`)
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; name: string }[];
  }

  it("returns only the requesting project's labels, so Settings-for-P == modal-for-P (FR3/FR5)", async () => {
    const pa = await freshProject("LA");
    const pb = await freshProject("LB");
    await createLabel(labelPost({ projectId: pa.id, name: "alpha" }));
    await createLabel(labelPost({ projectId: pb.id, name: "beta" }));

    const aNames = (await labelsFor(pa.id)).map((l) => l.name);
    const bNames = (await labelsFor(pb.id)).map((l) => l.name);
    expect(aNames).toEqual(["alpha"]);
    expect(bNames).toEqual(["beta"]);
    // A label created on B must NOT appear on A — this is exactly the context
    // mismatch VSK-28 fixes at the UI layer; the scoping itself is correct.
    expect(aNames).not.toContain("beta");
  });

  it("is idempotent on [projectId, name] and keeps same-named labels distinct across projects (FR6)", async () => {
    const pa = await freshProject("LC");
    const pb = await freshProject("LD");
    // Same name twice on A → one row, reused (200 not a duplicate).
    const first = await createLabel(labelPost({ projectId: pa.id, name: "dup" }));
    const second = await createLabel(labelPost({ projectId: pa.id, name: "dup" }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await first.json()).id).toBe((await second.json()).id);
    expect(await labelsFor(pa.id)).toHaveLength(1);

    // Same name on a different project is a separate label (per-project unique).
    await createLabel(labelPost({ projectId: pb.id, name: "dup" }));
    const aDup = (await labelsFor(pa.id)).find((l) => l.name === "dup");
    const bDup = (await labelsFor(pb.id)).find((l) => l.name === "dup");
    expect(aDup && bDup && aDup.id !== bDup.id).toBe(true);
  });
});
