"use client";

import { useState } from "react";

export type Ticket = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  columnId: string;
};

export type ColumnData = {
  id: string;
  name: string;
  order: number;
  tickets: Ticket[];
};

export default function Board({
  projectId,
  initialColumns,
}: {
  projectId: string;
  initialColumns: ColumnData[];
}) {
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  async function addColumn() {
    const name = prompt("Column name (e.g. To Do)");
    if (!name?.trim()) return;
    const res = await fetch("/api/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: name.trim(), order: columns.length }),
    });
    if (res.ok) {
      const col: ColumnData = await res.json();
      setColumns((prev) => [...prev, { ...col, tickets: [] }]);
    }
  }

  async function addTicket(columnId: string) {
    const title = prompt("Ticket title");
    if (!title?.trim()) return;
    const col = columns.find((c) => c.id === columnId);
    const order = col ? col.tickets.length : 0;
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId, title: title.trim(), order }),
    });
    if (res.ok) {
      const ticket: Ticket = await res.json();
      setColumns((prev) =>
        prev.map((c) => (c.id === columnId ? { ...c, tickets: [...c.tickets, ticket] } : c))
      );
    }
  }

  async function moveTicket(ticketId: string, toColumnId: string) {
    // Find source
    let moved: Ticket | undefined;
    const next = columns.map((c) => {
      const idx = c.tickets.findIndex((t) => t.id === ticketId);
      if (idx >= 0) {
        moved = c.tickets[idx];
        return { ...c, tickets: c.tickets.filter((t) => t.id !== ticketId) };
      }
      return c;
    });
    if (!moved || moved.columnId === toColumnId) {
      setOverCol(null);
      setDragId(null);
      return;
    }
    const target = next.find((c) => c.id === toColumnId)!;
    const newOrder = target.tickets.length;
    const updated = { ...moved, columnId: toColumnId, order: newOrder };
    setColumns(
      next.map((c) => (c.id === toColumnId ? { ...c, tickets: [...c.tickets, updated] } : c))
    );
    setOverCol(null);
    setDragId(null);

    // Persist
    await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: toColumnId, order: newOrder }),
    });
  }

  return (
    <div className="board">
      {columns.map((col) => (
        <div
          key={col.id}
          className={`column${overCol === col.id ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (overCol !== col.id) setOverCol(col.id);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOverCol(null);
          }}
          onDrop={() => dragId && moveTicket(dragId, col.id)}
        >
          <div className="column-title">
            <span>{col.name}</span>
            <span className="column-count">{col.tickets.length}</span>
          </div>

          {col.tickets.map((t) => (
            <div
              key={t.id}
              className={`ticket${dragId === t.id ? " dragging" : ""}`}
              draggable
              onDragStart={() => setDragId(t.id)}
              onDragEnd={() => {
                setDragId(null);
                setOverCol(null);
              }}
            >
              <div className="ticket-title">{t.title}</div>
              {t.description && <div className="ticket-desc">{t.description}</div>}
            </div>
          ))}

          <button className="add-ticket" onClick={() => addTicket(col.id)}>
            + Add ticket
          </button>
        </div>
      ))}

      <div className="column" style={{ background: "transparent", border: "1px dashed var(--border)" }}>
        <button className="ghost" style={{ width: "100%" }} onClick={addColumn}>
          + Add column
        </button>
      </div>
    </div>
  );
}
