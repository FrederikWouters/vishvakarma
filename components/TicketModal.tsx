"use client";

import { useEffect, useRef, useState } from "react";
import type { Ticket, Label } from "./Board";
import { RichTextEditor, sanitizeHtml, stripHtml } from "./RichText";
import { useDialogs } from "./Dialogs";
import { LIMITS } from "@/lib/limits";
import { trapTab } from "./focusTrap";

const PALETTE = [
  "#6b7280", "#ef4444", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

export default function TicketModal({
  ticket,
  projectId,
  projectKey,
  statusName,
  onClose,
  onSaved,
}: {
  ticket: Ticket;
  projectId: string;
  projectKey: string;
  statusName: string;
  onClose: () => void;
  onSaved: (t: Ticket) => void;
}) {
  const [title, setTitle] = useState(ticket.title);
  const [description, setDescription] = useState(ticket.description ?? "");
  const [labels, setLabels] = useState<Label[]>(ticket.labels);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dialogs = useDialogs();

  // Load the project's existing labels for the picker.
  useEffect(() => {
    fetch(`/api/labels?projectId=${projectId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Label[]) => setAllLabels(data))
      .catch(() => setAllLabels([]));
  }, [projectId]);

  // Close on Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    titleRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasLabel = (id: string) => labels.some((l) => l.id === id);

  function toggleLabel(label: Label) {
    setLabels((prev) =>
      prev.some((l) => l.id === label.id)
        ? prev.filter((l) => l.id !== label.id)
        : [...prev, label]
    );
  }

  async function createLabel(): Promise<Label | null> {
    const name = newName.trim();
    if (!name) return null;
    const res = await fetch("/api/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name, color: newColor }),
    });
    if (!res.ok) return null;
    const label: Label = await res.json();
    setAllLabels((prev) => (prev.some((l) => l.id === label.id) ? prev : [...prev, label]));
    setLabels((prev) => (prev.some((l) => l.id === label.id) ? prev : [...prev, label]));
    setNewName("");
    return label;
  }

  async function save() {
    setSaving(true);
    try {
      // Flush a label the user typed but didn't click "Add" — otherwise Save
      // would silently drop it. Build the final id list from the result, not
      // from React state (setState is async and wouldn't be visible yet).
      let finalLabels = labels;
      if (newName.trim()) {
        const created = await createLabel();
        if (created && !finalLabels.some((l) => l.id === created.id)) {
          finalLabels = [...finalLabels, created];
        }
      }
      // Sanitize the editor HTML; collapse an effectively-empty body to "".
      const cleanHtml = sanitizeHtml(description);
      const descOut = stripHtml(cleanHtml) ? cleanHtml : "";
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || ticket.title,
          description: descOut,
          labelIds: finalLabels.map((l) => l.id),
        }),
      });
      if (!res.ok) {
        // Surface the failure instead of silently returning; the modal stays
        // open so the user's edits aren't lost (VSK-21).
        await dialogs.alert({
          title: "Couldn't save ticket",
          message: "Your changes weren't saved. Please try again.",
        });
        return;
      }
      const updated = await res.json();
      onSaved({
        ...ticket,
        title: updated.title,
        description: updated.description,
        labels: updated.labels ?? finalLabels,
      });
      onClose();
    } catch {
      // Network error / fetch threw — don't leave the button stuck on "Saving…".
      await dialogs.alert({
        title: "Couldn't save ticket",
        message: "Your changes weren't saved. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  const unusedLabels = allLabels.filter((l) => !hasLabel(l.id));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Ticket ${projectKey}-${ticket.number}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, modalRef.current)}
      >
        <div className="modal-head">
          <span className="modal-key">
            {projectKey}-{ticket.number}
          </span>
          <span className="modal-status">{statusName}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <label className="modal-label">Title</label>
        <input
          ref={titleRef}
          className="modal-input"
          value={title}
          maxLength={LIMITS.ticketTitle}
          onChange={(e) => setTitle(e.target.value)}
        />

        <label className="modal-label">Description</label>
        <RichTextEditor initialValue={ticket.description ?? ""} onChange={setDescription} />

        <label className="modal-label">Labels</label>
        <div className="modal-chips">
          {labels.length === 0 && <span className="subtle">None</span>}
          {labels.map((l) => (
            <button
              key={l.id}
              className="chip chip-removable"
              style={{ backgroundColor: l.color }}
              onClick={() => toggleLabel(l)}
              title="Remove label"
            >
              {l.name} <span aria-hidden>×</span>
            </button>
          ))}
        </div>

        {unusedLabels.length > 0 && (
          <div className="modal-chips modal-chips-add">
            {unusedLabels.map((l) => (
              <button
                key={l.id}
                className="chip chip-add"
                style={{ borderColor: l.color, color: l.color }}
                onClick={() => toggleLabel(l)}
                title="Add label"
              >
                + {l.name}
              </button>
            ))}
          </div>
        )}

        <div className="modal-newlabel">
          <input
            className="modal-input modal-input-inline"
            value={newName}
            maxLength={LIMITS.labelName}
            placeholder="New label…"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createLabel();
              }
            }}
          />
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`swatch${newColor === c ? " selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setNewColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <button className="btn" onClick={createLabel} disabled={!newName.trim()}>
            Add
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
