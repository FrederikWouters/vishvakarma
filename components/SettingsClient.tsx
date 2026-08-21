"use client";

import { useState } from "react";
import { BOARDS } from "@/lib/boards";
import { useDialogs } from "./Dialogs";
import { LIMITS } from "@/lib/limits";

const PALETTE = [
  "#6b7280", "#ef4444", "#f59e0b", "#10b981",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6",
];

type Col = { id: string; name: string; board: string; order: number; ticketCount: number };
type Lab = { id: string; name: string; color: string };
type Proj = { id: string; name: string; key: string; columns: Col[]; labels: Lab[] };

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data } as { ok: boolean; data: any };
}

export default function SettingsClient({ projects: initial }: { projects: Proj[] }) {
  const dialogs = useDialogs();
  const [projects, setProjects] = useState<Proj[]>(initial);
  const [selectedId, setSelectedId] = useState<string>(initial[0]?.id ?? "");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(PALETTE[0]);

  const project = projects.find((p) => p.id === selectedId);

  function patchProject(fn: (p: Proj) => Proj) {
    setProjects((prev) => prev.map((p) => (p.id === selectedId ? fn(p) : p)));
  }

  // ── Columns ────────────────────────────────────────────────────
  async function addColumn(board: string) {
    const name = await dialogs.prompt({
      title: "Add column",
      label: "Column name",
      placeholder: "e.g. To Do",
      confirmText: "Add",
      maxLength: LIMITS.columnName,
    });
    if (!name?.trim() || !project) return;
    const { ok, data } = await api("/api/columns", "POST", {
      projectId: project.id,
      board,
      name: name.trim(),
    });
    if (!ok) return dialogs.alert({ title: "Couldn't add column", message: data.error });
    patchProject((p) => ({
      ...p,
      columns: [...p.columns, { ...data, ticketCount: 0 }],
    }));
  }

  async function renameColumn(col: Col) {
    const name = await dialogs.prompt({
      title: "Rename column",
      label: "Column name",
      initial: col.name,
      confirmText: "Save",
      maxLength: LIMITS.columnName,
    });
    if (!name?.trim()) return;
    const { ok, data } = await api(`/api/columns/${col.id}`, "PATCH", { name: name.trim() });
    if (!ok) return dialogs.alert({ title: "Couldn't rename", message: data.error });
    patchProject((p) => ({
      ...p,
      columns: p.columns.map((c) => (c.id === col.id ? { ...c, name: data.name } : c)),
    }));
  }

  async function deleteColumn(col: Col) {
    if (col.ticketCount > 0) {
      return dialogs.alert({
        title: "Column not empty",
        message: `"${col.name}" has ${col.ticketCount} ticket(s). Move or delete them first.`,
      });
    }
    const ok = await dialogs.confirm({
      title: "Delete column",
      message: `Delete "${col.name}"?`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const res = await api(`/api/columns/${col.id}`, "DELETE");
    if (!res.ok) return dialogs.alert({ title: "Couldn't delete", message: res.data.error });
    patchProject((p) => ({ ...p, columns: p.columns.filter((c) => c.id !== col.id) }));
  }

  // ── Labels ─────────────────────────────────────────────────────
  async function createLabel() {
    const name = newLabelName.trim();
    if (!name || !project) return;
    const { ok, data } = await api("/api/labels", "POST", {
      projectId: project.id,
      name,
      color: newLabelColor,
    });
    if (!ok) return dialogs.alert({ title: "Couldn't create label", message: data.error });
    patchProject((p) => ({
      ...p,
      labels: p.labels.some((l) => l.id === data.id)
        ? p.labels.map((l) => (l.id === data.id ? data : l))
        : [...p.labels, data],
    }));
    setNewLabelName("");
  }

  async function renameLabel(l: Lab) {
    const name = await dialogs.prompt({
      title: "Rename label",
      label: "Label name",
      initial: l.name,
      confirmText: "Save",
      maxLength: LIMITS.labelName,
    });
    if (!name?.trim()) return;
    const { ok, data } = await api(`/api/labels/${l.id}`, "PATCH", { name: name.trim() });
    if (!ok) return dialogs.alert({ title: "Couldn't rename", message: data.error });
    patchProject((p) => ({
      ...p,
      labels: p.labels.map((x) => (x.id === l.id ? { ...x, name: data.name } : x)),
    }));
  }

  async function recolorLabel(l: Lab, color: string) {
    if (color === l.color) return;
    const { ok, data } = await api(`/api/labels/${l.id}`, "PATCH", { color });
    if (!ok) return;
    patchProject((p) => ({
      ...p,
      labels: p.labels.map((x) => (x.id === l.id ? { ...x, color: data.color } : x)),
    }));
  }

  async function deleteLabel(l: Lab) {
    const ok = await dialogs.confirm({
      title: "Delete label",
      message: `Delete "${l.name}"? It will be removed from all tickets.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const res = await api(`/api/labels/${l.id}`, "DELETE");
    if (!res.ok) return;
    patchProject((p) => ({ ...p, labels: p.labels.filter((x) => x.id !== l.id) }));
  }

  if (!project) return null;

  return (
    <div className="settings">
      <div className="settings-picker">
        <label className="modal-label">Project</label>
        <select
          className="modal-input"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.key})
            </option>
          ))}
        </select>
      </div>

      <section className="settings-section">
        <h2 className="settings-heading">Columns</h2>
        {BOARDS.map((b) => {
          const cols = project.columns.filter((c) => c.board === b.slug);
          return (
            <div key={b.slug} className="settings-board">
              <div className="settings-board-head">
                <span>{b.label}</span>
                <button className="btn btn-sm" onClick={() => addColumn(b.slug)}>
                  + Add
                </button>
              </div>
              {cols.length === 0 && <div className="subtle settings-empty">No columns</div>}
              {cols.map((c) => (
                <div key={c.id} className="settings-row">
                  <span className="settings-row-name">{c.name}</span>
                  <span className="settings-count subtle">{c.ticketCount}</span>
                  <button className="btn btn-sm" onClick={() => renameColumn(c)}>
                    Rename
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => deleteColumn(c)}
                    disabled={c.ticketCount > 0}
                    title={c.ticketCount > 0 ? "Column has tickets" : "Delete column"}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">Labels</h2>
        {project.labels.length === 0 && (
          <div className="subtle settings-empty">No labels yet</div>
        )}
        {project.labels.map((l) => (
          <div key={l.id} className="settings-row">
            <span className="chip chip-sm" style={{ backgroundColor: l.color }}>
              {l.name}
            </span>
            <div className="swatches settings-swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`swatch${l.color === c ? " selected" : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => recolorLabel(l, c)}
                  aria-label={`Recolor ${c}`}
                />
              ))}
            </div>
            <button className="btn btn-sm" onClick={() => renameLabel(l)}>
              Rename
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => deleteLabel(l)}>
              Delete
            </button>
          </div>
        ))}

        <div className="settings-newlabel">
          <input
            className="modal-input modal-input-inline"
            value={newLabelName}
            maxLength={LIMITS.labelName}
            placeholder="New label…"
            onChange={(e) => setNewLabelName(e.target.value)}
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
                className={`swatch${newLabelColor === c ? " selected" : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setNewLabelColor(c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <button className="btn" onClick={createLabel} disabled={!newLabelName.trim()}>
            Add label
          </button>
        </div>
      </section>
    </div>
  );
}
