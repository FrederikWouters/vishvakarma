"use client";

import { useState } from "react";
import { BOARDS } from "@/lib/boards";

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

export type SequenceColumn = { id: string; name: string; board: string };

export default function Board({
  projectId,
  board,
  sequence,
  initialColumns,
}: {
  projectId: string;
  board: string;
  sequence: SequenceColumn[];
  initialColumns: ColumnData[];
}) {
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  async function addColumn() {
    setMenuOpen(false);
    const name = prompt("Column name (e.g. To Do)");
    if (!name?.trim()) return;
    const res = await fetch("/api/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, board, name: name.trim() }),
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

  // Adjacent columns in the whole project sequence, or null at the ends.
  function nextColumn(columnId: string): SequenceColumn | null {
    const idx = sequence.findIndex((c) => c.id === columnId);
    if (idx < 0 || idx >= sequence.length - 1) return null;
    return sequence[idx + 1];
  }

  function prevColumn(columnId: string): SequenceColumn | null {
    const idx = sequence.findIndex((c) => c.id === columnId);
    if (idx <= 0) return null;
    return sequence[idx - 1];
  }

  // Move a ticket to an adjacent column (used by both Advance and Back).
  async function moveToColumn(ticket: Ticket, target: SequenceColumn) {
    const targetVisible = columns.some((c) => c.id === target.id);
    setColumns((prev) => {
      const cleared = prev.map((c) =>
        c.id === ticket.columnId
          ? { ...c, tickets: c.tickets.filter((t) => t.id !== ticket.id) }
          : c
      );
      // If the target column is on this board, drop the ticket in; otherwise it
      // moves to another board and leaves this view.
      if (!targetVisible) return cleared;
      return cleared.map((c) =>
        c.id === target.id
          ? { ...c, tickets: [...c.tickets, { ...ticket, columnId: target.id }] }
          : c
      );
    });

    // Server appends to the end of the target column (no order sent).
    await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId: target.id }),
    });
  }

  async function deleteTicket(ticket: Ticket) {
    if (!confirm(`Delete ticket "${ticket.title}"? This cannot be undone.`)) return;
    setColumns((prev) =>
      prev.map((c) =>
        c.id === ticket.columnId
          ? { ...c, tickets: c.tickets.filter((t) => t.id !== ticket.id) }
          : c
      )
    );
    await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
  }

  return (
    <>
      <div className="board-toolbar">
        <nav className="board-tabs">
          {BOARDS.map((b) => (
            <a
              key={b.slug}
              href={`/projects/${projectId}/board/${b.slug}`}
              className={`board-tab${b.slug === board ? " active" : ""}`}
            >
              {b.label}
            </a>
          ))}
        </nav>

        <div className="dropdown">
          <button
            className="ghost dropdown-trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            Configure columns <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <>
              <div className="dropdown-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="dropdown-menu">
                <button className="dropdown-item" onClick={addColumn}>
                  + Add column
                </button>
              </div>
            </>
          )}
        </div>
      </div>

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
              {(() => {
                const prev = prevColumn(t.columnId);
                const next = nextColumn(t.columnId);
                const open = openMenuId === t.id;
                return (
                  <>
                    <button
                      className="ticket-menu-btn"
                      title="Options"
                      aria-expanded={open}
                      onClick={() => setOpenMenuId(open ? null : t.id)}
                    >
                      ⋯
                    </button>
                    {open && (
                      <>
                        <div className="dropdown-backdrop" onClick={() => setOpenMenuId(null)} />
                        <div className="ticket-menu">
                          <button
                            className="ticket-menu-item"
                            disabled={!prev}
                            onClick={() => {
                              setOpenMenuId(null);
                              if (prev) moveToColumn(t, prev);
                            }}
                          >
                            ← Back{prev ? ` to ${prev.name}` : ""}
                          </button>
                          <button
                            className="ticket-menu-item"
                            disabled={!next}
                            onClick={() => {
                              setOpenMenuId(null);
                              if (next) moveToColumn(t, next);
                            }}
                          >
                            Advance{next ? ` to ${next.name}` : ""} →
                          </button>
                          <button
                            className="ticket-menu-item danger"
                            onClick={() => {
                              setOpenMenuId(null);
                              deleteTicket(t);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
              <div className="ticket-title">{t.title}</div>
              {t.description && <div className="ticket-desc">{t.description}</div>}
              {(() => {
                const prev = prevColumn(t.columnId);
                const next = nextColumn(t.columnId);
                if (!prev && !next) return null;
                return (
                  <div className="ticket-actions">
                    {prev && (
                      <button
                        className="move-btn back-btn"
                        title={`Back to ${prev.name}`}
                        onClick={() => moveToColumn(t, prev)}
                      >
                        ← Back
                      </button>
                    )}
                    {next && (
                      <button
                        className="move-btn advance-btn"
                        title={`Advance to ${next.name}`}
                        onClick={() => moveToColumn(t, next)}
                      >
                        Advance →
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}

          <button className="add-ticket" onClick={() => addTicket(col.id)}>
            + Add ticket
          </button>
        </div>
      ))}
      </div>
    </>
  );
}
