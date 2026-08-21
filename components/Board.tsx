"use client";

import { useState } from "react";
import { BOARDS } from "@/lib/boards";
import TicketModal from "./TicketModal";
import { useDialogs } from "./Dialogs";
import { stripHtml } from "@/lib/html";
import { LIMITS } from "@/lib/limits";

export type Label = {
  id: string;
  name: string;
  color: string;
};

export type Ticket = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  number: number;
  columnId: string;
  labels: Label[];
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
  projectKey,
  board,
  sequence,
  initialColumns,
}: {
  projectId: string;
  projectKey: string;
  board: string;
  sequence: SequenceColumn[];
  initialColumns: ColumnData[];
}) {
  const [columns, setColumns] = useState<ColumnData[]>(initialColumns);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // The ticket the drop indicator sits *before* within `overCol`; null = append
  // to the end of the column.
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [modalTicketId, setModalTicketId] = useState<string | null>(null);
  const dialogs = useDialogs();

  async function addTicket(columnId: string) {
    const title = await dialogs.prompt({
      title: "Add ticket",
      label: "Ticket title",
      placeholder: "What needs doing?",
      confirmText: "Add",
      maxLength: LIMITS.ticketTitle,
    });
    if (!title?.trim()) return;
    const col = columns.find((c) => c.id === columnId);
    const order = col ? col.tickets.length : 0;
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId, title: title.trim(), order }),
    });
    if (res.ok) {
      const created = await res.json();
      // The create endpoint doesn't return labels; a new ticket has none.
      const ticket: Ticket = { ...created, labels: created.labels ?? [] };
      setColumns((prev) =>
        prev.map((c) => (c.id === columnId ? { ...c, tickets: [...c.tickets, ticket] } : c))
      );
    }
  }

  function updateTicket(updated: Ticket) {
    setColumns((prev) =>
      prev.map((c) => ({
        ...c,
        tickets: c.tickets.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
      }))
    );
  }

  function resetDrag() {
    setDragId(null);
    setOverCol(null);
    setDropBeforeId(null);
  }

  async function reorderColumn(cols: ColumnData[], columnId: string): Promise<boolean> {
    const col = cols.find((c) => c.id === columnId);
    if (!col) return true;
    try {
      const res = await fetch("/api/tickets/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, orderedIds: col.tickets.map((t) => t.id) }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Drop the dragged ticket into `toColumnId` immediately before `beforeId`
  // (or at the end when beforeId is null). Handles both within-lane reordering
  // and cross-lane drops at a position.
  async function dropTicket(ticketId: string, toColumnId: string, beforeId: string | null) {
    let moved: Ticket | undefined;
    let fromColumnId: string | undefined;
    columns.forEach((c) => {
      const t = c.tickets.find((x) => x.id === ticketId);
      if (t) {
        moved = t;
        fromColumnId = c.id;
      }
    });
    if (!moved || !fromColumnId || beforeId === ticketId) {
      resetDrag();
      return;
    }

    // Remove from its current column, then insert into the target.
    const withoutTicket = columns.map((c) =>
      c.tickets.some((t) => t.id === ticketId)
        ? { ...c, tickets: c.tickets.filter((t) => t.id !== ticketId) }
        : c
    );
    const movedTicket: Ticket = { ...moved, columnId: toColumnId };
    const next = withoutTicket.map((c) => {
      if (c.id !== toColumnId) return c;
      const arr = [...c.tickets];
      const at = beforeId ? arr.findIndex((t) => t.id === beforeId) : -1;
      if (at < 0) arr.push(movedTicket);
      else arr.splice(at, 0, movedTicket);
      return { ...c, tickets: arr };
    });

    const snapshot = columns;
    setColumns(next);
    resetDrag();

    // Persist the new ordering: the target column always, the source column too
    // when it changed (its remaining tickets' orders shifted). If either write
    // fails, roll the board back so it doesn't drift from the database.
    let ok = await reorderColumn(next, toColumnId);
    if (ok && fromColumnId !== toColumnId) ok = await reorderColumn(next, fromColumnId);
    if (!ok) {
      setColumns(snapshot);
      dialogs.alert({
        title: "Couldn't move ticket",
        message: "The change wasn't saved. The board has been restored.",
      });
    }
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
    const snapshot = columns;
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
    let ok = false;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: target.id }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setColumns(snapshot);
      dialogs.alert({
        title: "Couldn't move ticket",
        message: "The change wasn't saved. The board has been restored.",
      });
    }
  }

  async function deleteTicket(ticket: Ticket) {
    const ok = await dialogs.confirm({
      title: "Delete ticket",
      message: `Delete "${ticket.title}"? This cannot be undone.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const snapshot = columns;
    setColumns((prev) =>
      prev.map((c) =>
        c.id === ticket.columnId
          ? { ...c, tickets: c.tickets.filter((t) => t.id !== ticket.id) }
          : c
      )
    );
    let deleted = false;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
      deleted = res.ok;
    } catch {
      deleted = false;
    }
    if (!deleted) {
      setColumns(snapshot);
      dialogs.alert({
        title: "Couldn't delete ticket",
        message: "The ticket wasn't deleted. The board has been restored.",
      });
    }
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
      </div>

      <div className="board">
      {columns.map((col) => (
        <div
          key={col.id}
          className={`column${overCol === col.id ? " drag-over" : ""}`}
          onDragOver={(e) => {
            if (!dragId) return;
            e.preventDefault();
            // Hovering the column's empty area → drop at the end.
            if (overCol !== col.id) setOverCol(col.id);
            setDropBeforeId(null);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOverCol(null);
          }}
          onDrop={() => dragId && dropTicket(dragId, col.id, dropBeforeId)}
        >
          <div className="column-title">
            <span>{col.name}</span>
            <span className="column-count">{col.tickets.length}</span>
          </div>

          {col.tickets.map((t) => (
            <div key={`slot-${t.id}`}>
            {overCol === col.id && dropBeforeId === t.id && (
              <div className="drop-indicator" />
            )}
            <div
              key={t.id}
              className={`ticket${dragId === t.id ? " dragging" : ""}`}
              draggable
              onDragStart={() => setDragId(t.id)}
              onDragEnd={resetDrag}
              onDragOver={(e) => {
                if (!dragId || dragId === t.id) return;
                e.preventDefault();
                e.stopPropagation();
                // Above the card's midpoint drops before it; below drops before
                // the next card (or at the end for the last card).
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientY - rect.top > rect.height / 2;
                const idx = col.tickets.findIndex((x) => x.id === t.id);
                const beforeId = after
                  ? col.tickets[idx + 1]?.id ?? null
                  : t.id;
                if (overCol !== col.id) setOverCol(col.id);
                if (dropBeforeId !== beforeId) setDropBeforeId(beforeId);
              }}
              onClick={(e) => {
                // Don't open the modal when clicking a button (⋯ menu, Back/
                // Advance) or while the options menu is open.
                if ((e.target as HTMLElement).closest("button")) return;
                if (openMenuId) return;
                setModalTicketId(t.id);
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
              <div className="ticket-id">{projectKey}-{t.number}</div>
              <div className="ticket-title">{t.title}</div>
              {t.description && <div className="ticket-desc">{stripHtml(t.description)}</div>}
              {t.labels.length > 0 && (
                <div className="ticket-labels">
                  {t.labels.map((l) => (
                    <span key={l.id} className="chip chip-sm" style={{ backgroundColor: l.color }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
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
            </div>
          ))}
          {overCol === col.id && dropBeforeId === null && dragId && (
            <div className="drop-indicator" />
          )}

          <button className="add-ticket" onClick={() => addTicket(col.id)}>
            + Add ticket
          </button>
        </div>
      ))}
      </div>

      {modalTicketId && (() => {
        const t = columns.flatMap((c) => c.tickets).find((x) => x.id === modalTicketId);
        if (!t) return null;
        const statusName = columns.find((c) => c.id === t.columnId)?.name ?? "";
        return (
          <TicketModal
            ticket={t}
            projectId={projectId}
            projectKey={projectKey}
            statusName={statusName}
            onClose={() => setModalTicketId(null)}
            onSaved={updateTicket}
          />
        );
      })()}
    </>
  );
}
