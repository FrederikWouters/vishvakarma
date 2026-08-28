"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BOARDS, CANCELLED_COLUMN } from "@/lib/boards";
// The ticket modal pulls in the whole TipTap/RichText editor (~150 kB of JS).
// The board itself never needs it until a card is opened, so load it lazily:
// this keeps the editor out of the board route's first-load bundle and only
// fetches it on the first modal open. ssr:false is safe — the modal is
// interactive-only and never rendered on the server (it opens on click).
const TicketModal = dynamic(() => import("./TicketModal"), { ssr: false });
import { useDialogs } from "./Dialogs";
import { stripHtml } from "@/lib/html";
import { LIMITS } from "@/lib/limits";
import { computeDropBeforeId, moveWithinColumn, autoScrollDir } from "@/lib/dragOrder";

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

// Tuning for the custom pointer-drag (VSK-14).
const MOVE_THRESHOLD = 7; // px before a mouse press becomes a drag
const HOLD_MS = 180; // press-and-hold to start a drag on touch
const EDGE_BAND = 48; // px from an edge that triggers auto-scroll
const SCROLL_SPEED = 14; // px per frame while auto-scrolling
const SNAP_MS = 150; // settle animation on drop

type DragState = {
  ticketId: string;
  fromColumnId: string;
  cardW: number;
  cardH: number;
  grabDx: number;
  grabDy: number;
  x: number;
  y: number;
};

// The visual body of a ticket card, shared by the in-column card and the
// full-opacity card carried under the pointer so the two look identical.
function TicketCardBody({
  ticket,
  projectKey,
}: {
  ticket: Ticket;
  projectKey: string;
}) {
  return (
    <>
      <div className="ticket-id">
        {projectKey}-{ticket.number}
      </div>
      <div className="ticket-title">{ticket.title}</div>
      {ticket.description && (
        <div className="ticket-desc">{stripHtml(ticket.description)}</div>
      )}
      {ticket.labels.length > 0 && (
        <div className="ticket-labels">
          {ticket.labels.map((l) => (
            <span
              key={l.id}
              className="chip chip-sm"
              style={{ backgroundColor: l.color }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [modalTicketId, setModalTicketId] = useState<string | null>(null);
  const dialogs = useDialogs();

  // Drag visuals (drive rendering).
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  // The ticket the gap sits *before* within `overCol`; null = end of column.
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const [snapPos, setSnapPos] = useState<{ x: number; y: number } | null>(null);

  // Gesture bookkeeping (no re-render).
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const dropTargetRef = useRef<{ col: string | null; before: string | null }>({
    col: null,
    before: null,
  });
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const gapRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

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
    let created: Ticket | null = null;
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, title: title.trim(), order }),
      });
      if (res.ok) created = await res.json();
    } catch {
      created = null;
    }
    if (!created) {
      dialogs.alert({
        title: "Couldn't add ticket",
        message: "The ticket wasn't created. Please try again.",
      });
      return;
    }
    // The create endpoint doesn't return labels; a new ticket has none.
    const ticket: Ticket = { ...created, labels: created.labels ?? [] };
    setColumns((prev) =>
      prev.map((c) => (c.id === columnId ? { ...c, tickets: [...c.tickets, ticket] } : c))
    );
  }

  function updateTicket(updated: Ticket, newColumnId?: string) {
    if (newColumnId) {
      // columnId already updated on the ticket object from the API response;
      // remove it from the old column and add to the new one if visible.
      setColumns((prev) => {
        const cleared = prev.map((c) => ({
          ...c,
          tickets: c.tickets.filter((t) => t.id !== updated.id),
        }));
        const targetVisible = cleared.some((c) => c.id === newColumnId);
        if (!targetVisible) return cleared;
        return cleared.map((c) =>
          c.id === newColumnId
            ? { ...c, tickets: [...c.tickets, { ...updated, columnId: newColumnId }] }
            : c
        );
      });
    } else {
      setColumns((prev) =>
        prev.map((c) => ({
          ...c,
          tickets: c.tickets.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
        }))
      );
    }
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
  // and cross-lane drops at a position. Persistence + rollback unchanged from
  // the native-DnD version — VSK-14 only rewrites the gesture layer.
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

  // Non-drag reorder within a lane (⋯-menu Move up/down) — the keyboard-reachable
  // alternative to dragging required by WCAG 2.5.7. Reuses the same optimistic +
  // rollback path as dropTicket via reorderColumn.
  async function moveTicketWithin(columnId: string, ticketId: string, dir: "up" | "down") {
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;
    const ids = col.tickets.map((t) => t.id);
    const nextIds = moveWithinColumn(ids, ticketId, dir);
    if (nextIds.join() === ids.join()) return; // no-op at an end
    const byId = new Map(col.tickets.map((t) => [t.id, t]));
    const next = columns.map((c) =>
      c.id === columnId
        ? { ...c, tickets: nextIds.map((id) => byId.get(id)!) }
        : c
    );
    const snapshot = columns;
    setColumns(next);
    const ok = await reorderColumn(next, columnId);
    if (!ok) {
      setColumns(snapshot);
      dialogs.alert({
        title: "Couldn't move ticket",
        message: "The change wasn't saved. The board has been restored.",
      });
    }
  }

  // Adjacent columns in the whole project sequence, or null at the ends.
  // The Cancelled column is off-flow: reachable only by explicit status change
  // (dropdown/drag), never by stepping with Back/Advance.
  const flowSequence = sequence.filter((c) => c.name !== CANCELLED_COLUMN);

  function nextColumn(columnId: string): SequenceColumn | null {
    const idx = flowSequence.findIndex((c) => c.id === columnId);
    if (idx < 0 || idx >= flowSequence.length - 1) return null;
    return flowSequence[idx + 1];
  }

  function prevColumn(columnId: string): SequenceColumn | null {
    const idx = flowSequence.findIndex((c) => c.id === columnId);
    if (idx <= 0) return null;
    return flowSequence[idx - 1];
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

  // ---- Custom pointer-drag (VSK-14) ---------------------------------------

  // Find the projected drop target under (x, y). The carried card is
  // pointer-events:none and the source card is not rendered in-flow, so
  // elementFromPoint sees the real column/cards beneath the pointer.
  function hitTest(x: number, y: number, draggedId: string) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const colEl = el?.closest("[data-col-id]") as HTMLElement | null;
    if (!colEl) return; // pointer outside any column → keep last target
    const colId = colEl.dataset.colId!;
    const col = columnsRef.current.find((c) => c.id === colId);
    const ids = col ? col.tickets.map((t) => t.id).filter((id) => id !== draggedId) : [];

    const cardEl = el?.closest("[data-ticket-id]") as HTMLElement | null;
    let before: string | null = null;
    if (cardEl && cardEl.dataset.ticketId) {
      const hoveredId = cardEl.dataset.ticketId;
      const r = cardEl.getBoundingClientRect();
      before = computeDropBeforeId(y, r.top, r.height, ids, hoveredId);
    } else {
      before = null; // empty area of the column → append at the end
    }
    dropTargetRef.current = { col: colId, before };
    setOverCol(colId);
    setDropBeforeId(before);
  }

  function stopAutoScroll() {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }

  function startAutoScroll() {
    stopAutoScroll();
    const tick = () => {
      const p = lastPointer.current;
      if (p) {
        // Board horizontal scroll (many columns on a narrow viewport).
        const b = boardRef.current;
        if (b) {
          const r = b.getBoundingClientRect();
          const dir = autoScrollDir(p.x, r.left, r.right, EDGE_BAND);
          if (dir) b.scrollLeft += dir * SCROLL_SPEED;
        }
        // Vertical scroll of the page toward a long column's off-screen slots.
        const vdir = autoScrollDir(p.y, 0, window.innerHeight, EDGE_BAND);
        if (vdir) window.scrollBy(0, vdir * SCROLL_SPEED);
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function endDrag() {
    stopAutoScroll();
    document.body.classList.remove("board-dragging");
    setDrag(null);
    setOverCol(null);
    setDropBeforeId(null);
    setSnapPos(null);
    lastPointer.current = null;
    dropTargetRef.current = { col: null, before: null };
  }

  function onCardPointerDown(e: React.PointerEvent<HTMLDivElement>, ticket: Ticket, colId: string) {
    // Left button only for mouse; let the ⋯ menu / Back / Advance buttons work;
    // don't start a drag while a menu is open.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (openMenuId) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const cardEl = e.currentTarget;
    const rect = cardEl.getBoundingClientRect();
    const grabDx = startX - rect.left;
    const grabDy = startY - rect.top;
    const pointerId = e.pointerId;
    const isTouch = e.pointerType !== "mouse";
    let active = false;
    let holdTimer: number | null = null;

    const activate = () => {
      if (active) return;
      active = true;
      if (holdTimer != null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      try {
        cardEl.setPointerCapture(pointerId);
      } catch {
        // Some browsers throw if the pointer already ended; safe to ignore.
      }
      document.body.classList.add("board-dragging");
      lastPointer.current = { x: startX, y: startY };
      setDrag({
        ticketId: ticket.id,
        fromColumnId: colId,
        cardW: rect.width,
        cardH: rect.height,
        grabDx,
        grabDy,
        x: startX,
        y: startY,
      });
      dropTargetRef.current = { col: colId, before: ticket.id };
      setOverCol(colId);
      setDropBeforeId(ticket.id);
      hitTest(startX, startY, ticket.id);
      startAutoScroll();
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!active) {
        if (isTouch) {
          // Movement before the hold fires = the user is scrolling, not
          // dragging → abandon the pending drag and let the browser scroll.
          if (dist > MOVE_THRESHOLD) cleanup();
          return;
        }
        if (dist > MOVE_THRESHOLD) activate();
        else return;
      }
      ev.preventDefault(); // active drag: suppress scroll / text selection
      lastPointer.current = { x: ev.clientX, y: ev.clientY };
      setDrag((d) => (d ? { ...d, x: ev.clientX, y: ev.clientY } : d));
      hitTest(ev.clientX, ev.clientY, ticket.id);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (!active) return; // never activated → a plain tap; let onClick open modal
      ev.preventDefault();
      suppressClick.current = true; // swallow the click that follows the drop
      // Self-heal: on touch a drop may emit no click, which would otherwise
      // leave the flag set and swallow the next genuine tap.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 350);
      finishDrop(ticket.id);
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (active) endDrag(); // OS reclaimed the gesture → no persist, restore
    };

    const cleanup = () => {
      if (holdTimer != null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (isTouch) holdTimer = window.setTimeout(activate, HOLD_MS);
  }

  // Animate the carried card into the opened gap, then commit the reorder.
  function finishDrop(ticketId: string) {
    const { col, before } = dropTargetRef.current;
    const target = col ?? drag?.fromColumnId ?? null;
    const gap = gapRef.current;
    const commit = () => {
      if (target) dropTicket(ticketId, target, before);
      endDrag();
    };
    if (gap) {
      const r = gap.getBoundingClientRect();
      setSnapPos({ x: r.left, y: r.top }); // CSS transitions the carried card here
      window.setTimeout(commit, SNAP_MS);
    } else {
      commit();
    }
  }

  // Clean up any in-flight rAF if the component unmounts mid-drag.
  useEffect(() => () => stopAutoScroll(), []);

  // -------------------------------------------------------------------------

  const draggedTicket = drag
    ? columns.flatMap((c) => c.tickets).find((t) => t.id === drag.ticketId) ?? null
    : null;

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

      <div className="board" ref={boardRef}>
        {columns.map((col) => (
          <div
            key={col.id}
            data-col-id={col.id}
            className={`column${overCol === col.id ? " drag-over" : ""}`}
          >
            <div className="column-title">
              <span>{col.name}</span>
              <span className="column-count">{col.tickets.length}</span>
            </div>

            {col.tickets.map((t) => {
              const isDragged = drag?.ticketId === t.id;
              const showGap = !!drag && overCol === col.id && dropBeforeId === t.id;
              return (
                <div key={`slot-${t.id}`}>
                  {showGap && (
                    <div
                      ref={gapRef}
                      className="ticket-gap"
                      style={{ height: drag!.cardH }}
                      aria-hidden
                    />
                  )}
                  {/* The dragged card is lifted onto the pointer (rendered once
                      at the board root), so it is not drawn in-flow here — its
                      slot collapses and the gap shows where it will land. */}
                  {!isDragged && (
                    <div
                      data-ticket-id={t.id}
                      className="ticket"
                      draggable={false}
                      onPointerDown={(e) => onCardPointerDown(e, t, col.id)}
                      onClick={(e) => {
                        // A drag just ended → swallow the synthetic click so the
                        // drop doesn't open the modal (FR7).
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        // Don't open the modal when clicking a button (⋯ menu,
                        // Back/Advance) or while the options menu is open.
                        if ((e.target as HTMLElement).closest("button")) return;
                        if (openMenuId) return;
                        setModalTicketId(t.id);
                      }}
                    >
                      {(() => {
                        const prev = prevColumn(t.columnId);
                        const next = nextColumn(t.columnId);
                        const open = openMenuId === t.id;
                        const idx = col.tickets.findIndex((x) => x.id === t.id);
                        const canUp = idx > 0;
                        const canDown = idx < col.tickets.length - 1;
                        return (
                          <>
                            <button
                              className="ticket-menu-btn"
                              title="Options"
                              aria-label="Ticket options"
                              aria-expanded={open}
                              onClick={() => setOpenMenuId(open ? null : t.id)}
                            >
                              ⋯
                            </button>
                            {open && (
                              <>
                                <div
                                  className="dropdown-backdrop"
                                  onClick={() => setOpenMenuId(null)}
                                />
                                <div className="ticket-menu">
                                  <button
                                    className="ticket-menu-item"
                                    disabled={!canUp}
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      moveTicketWithin(col.id, t.id, "up");
                                    }}
                                  >
                                    ↑ Move up
                                  </button>
                                  <button
                                    className="ticket-menu-item"
                                    disabled={!canDown}
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      moveTicketWithin(col.id, t.id, "down");
                                    }}
                                  >
                                    ↓ Move down
                                  </button>
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
                      <TicketCardBody ticket={t} projectKey={projectKey} />
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
                  )}
                </div>
              );
            })}
            {!!drag && overCol === col.id && dropBeforeId === null && (
              <div
                ref={gapRef}
                className="ticket-gap"
                style={{ height: drag.cardH }}
                aria-hidden
              />
            )}

            <button className="add-ticket" onClick={() => addTicket(col.id)}>
              + Add ticket
            </button>
          </div>
        ))}
      </div>

      {/* The card carried under the pointer: full opacity, lifted, and
          pointer-events:none so hit-testing sees the board beneath it (FR1). */}
      {drag && draggedTicket && (
        <div
          className={`ticket ticket-carried${snapPos ? " snapping" : ""}`}
          style={{
            width: drag.cardW,
            transform: `translate(${(snapPos ? snapPos.x : drag.x - drag.grabDx)}px, ${
              snapPos ? snapPos.y : drag.y - drag.grabDy
            }px)`,
          }}
          aria-hidden
        >
          <TicketCardBody ticket={draggedTicket} projectKey={projectKey} />
        </div>
      )}

      {modalTicketId && (() => {
        const t = columns.flatMap((c) => c.tickets).find((x) => x.id === modalTicketId);
        if (!t) return null;
        return (
          <TicketModal
            ticket={t}
            projectId={projectId}
            projectKey={projectKey}
            sequence={sequence}
            onClose={() => setModalTicketId(null)}
            onSaved={updateTicket}
          />
        );
      })()}
    </>
  );
}
