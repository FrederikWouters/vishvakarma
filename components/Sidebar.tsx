"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BOARDS } from "@/lib/boards";

export type SidebarProject = { id: string; name: string; key: string };

const STORAGE_KEY = "vsk:sidebar:expanded";

export default function Sidebar({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname();

  // Which project id is currently in the URL, so we auto-expand it.
  const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;

  // Initial state matches the server render (only the active project open) to
  // avoid a hydration mismatch; localStorage is applied after mount below.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    activeProjectId ? { [activeProjectId]: true } : {}
  );
  const hydrated = useRef(false);

  // After mount: load the persisted open/closed state, dropping ids for
  // projects that no longer exist.
  useEffect(() => {
    let stored: Record<string, boolean> = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") ?? {};
    } catch {
      stored = {};
    }
    const known = new Set(projects.map((p) => p.id));
    const pruned: Record<string, boolean> = {};
    for (const [id, open] of Object.entries(stored)) {
      if (known.has(id)) pruned[id] = open;
    }
    hydrated.current = true;
    setExpanded(pruned);
    // Mount only — localStorage is the source of truth from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The active project defaults to open, but only when the user hasn't already
  // set a preference for it (so manually collapsing it sticks).
  useEffect(() => {
    if (!activeProjectId) return;
    setExpanded((prev) =>
      activeProjectId in prev ? prev : { ...prev, [activeProjectId]: true }
    );
  }, [activeProjectId]);

  // Persist every change back to localStorage (skip the pre-hydration render).
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [expanded]);

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));
  }

  return (
    <aside className="sidebar">
      <a href="/" className={`sidebar-home${pathname === "/" ? " active" : ""}`}>
        All projects
      </a>

      <div className="sidebar-tree">
        {projects.length === 0 && <div className="sidebar-empty subtle">No projects yet</div>}

        {projects.map((p) => {
          const open = expanded[p.id] ?? false;
          return (
            <div key={p.id} className="sidebar-project">
              <button
                className={`sidebar-project-btn${activeProjectId === p.id ? " active" : ""}`}
                onClick={() => toggle(p.id)}
                aria-expanded={open}
              >
                <span className={`chevron${open ? " open" : ""}`}>▸</span>
                <span className="sidebar-name">{p.name}</span>
              </button>

              {open && (
                <div className="sidebar-boards">
                  {BOARDS.map((b) => {
                    const href = `/projects/${p.id}/board/${b.slug}`;
                    const active = pathname === href;
                    return (
                      <a key={b.slug} href={href} className={`sidebar-board${active ? " active" : ""}`}>
                        {b.label}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
