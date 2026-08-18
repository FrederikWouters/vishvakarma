"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { BOARDS } from "@/lib/boards";

export type SidebarProject = { id: string; name: string; key: string };

export default function Sidebar({ projects }: { projects: SidebarProject[] }) {
  const pathname = usePathname();

  // Which project id is currently in the URL, so we auto-expand it.
  const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    activeProjectId ? { [activeProjectId]: true } : {}
  );

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
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
