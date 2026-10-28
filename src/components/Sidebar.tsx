import { CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AgentStatus, Workspace } from "../types";
import { makeWorkspace } from "../store/workspaces";
import { STATUS_COLORS, TabMeta } from "../lib/agents";
import "./Sidebar.css";

// Counters tint their chip with the status hue instead of relying on the hue
// alone, so the number stays cream-on-dark (14:1) and the colour reads from a
// filled background rather than a 6px dot.
function tint(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function workspaceInitials(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length === 0) return name.trim().slice(0, 1).toUpperCase() || "?";
  const letters = words.length === 1 ? words[0]!.slice(0, 2) : words[0]!.charAt(0) + words[1]!.charAt(0);
  return letters.toUpperCase();
}

function countStyle(status: AgentStatus): CSSProperties {
  const color = STATUS_COLORS[status];
  return {
    "--count-color": color,
    "--count-bg": tint(color, 0.16),
    "--count-border": tint(color, 0.55),
  } as CSSProperties;
}

interface Props {
  workspaces: Workspace[];
  activeId: string;
  workspaceStatus: Record<string, AgentStatus>;
  tabMeta: Record<string, TabMeta>;
  view: string;
  onSelect: (id: string) => void;
  onAdd: (ws: Workspace) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (next: Workspace[]) => void;
  onExport: (ws: Workspace) => void;
  onImport: (file: File) => void;
  onSettings: () => void;
  onHelp: () => void;
  onAbout: () => void;
  onCommands: () => void;
  onFieldnotes: () => void;
  onAllRunning: () => void;
}

export default function Sidebar({
  workspaces,
  activeId,
  tabMeta,
  view,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onExport,
  onImport,
  onSettings,
  onHelp,
  onAbout,
  onCommands,
  onFieldnotes,
  onAllRunning,
}: Props) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("mosaic-sidebar-collapsed") === "true");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  const dragSourceRef = useRef<number | null>(null);
  const insertIndexRef = useRef(0);
  const dragStartYRef = useRef(0);
  const movedRef = useRef(false);
  const didDragRef = useRef(false);
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

  useEffect(() => {
    localStorage.setItem("mosaic-sidebar-collapsed", String(collapsed));
  }, [collapsed]);

  // The workspace options menu closes on any click outside it.
  useEffect(() => {
    if (!menuId) return;
    function close(e: PointerEvent) {
      if (!(e.target as HTMLElement).closest(".ws-menu, .ws-more")) setMenuId(null);
    }
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuId]);

  // Pointer-based reorder (HTML5 drag-and-drop is unreliable in the Tauri webview).
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragSourceRef.current === null) return;
      if (Math.abs(e.clientY - dragStartYRef.current) > 4) movedRef.current = true;
      if (!movedRef.current) return;
      setDrag({ index: dragSourceRef.current, x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const item = el?.closest("[data-workspace-index]") as HTMLElement | null;
      if (!item) return;
      const idx = Number(item.dataset.workspaceIndex);
      const rect = item.getBoundingClientRect();
      // Insert above or below the hovered item depending on which half the
      // pointer is over, so the drop position is predictable.
      const insert = e.clientY > rect.top + rect.height / 2 ? idx + 1 : idx;
      if (insert !== insertIndexRef.current) {
        insertIndexRef.current = insert;
        setInsertIndex(insert);
      }
    }

    function onUp() {
      const src = dragSourceRef.current;
      const dst = insertIndexRef.current;
      if (movedRef.current && src !== null) {
        const next = [...workspacesRef.current];
        const [moved] = next.splice(src, 1);
        const adjusted = dst > src ? dst - 1 : dst;
        next.splice(adjusted, 0, moved);
        onReorderRef.current(next);
        didDragRef.current = true;
      }
      dragSourceRef.current = null;
      movedRef.current = false;
      setInsertIndex(null);
      setDrag(null);
    }

    // Stop text selection only while a workspace drag is actually happening,
    // so normal terminal text selection is untouched.
    function preventSelect(e: Event) {
      if (dragSourceRef.current !== null) e.preventDefault();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("selectstart", preventSelect);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("selectstart", preventSelect);
    };
  }, []);

  // Dropping right next to where it already is changes nothing — don't promise a move.
  const showInsert = drag !== null && insertIndex !== null && insertIndex !== drag.index && insertIndex !== drag.index + 1;

  function handleAdd() {
    const ws = makeWorkspace(`Workspace ${workspaces.length + 1}`);
    onAdd(ws);
  }

  function startRename(ws: Workspace) {
    setRenamingId(ws.id);
    setDraft(ws.name);
  }

  function commitRename(id: string) {
    if (draft.trim()) onRename(id, draft.trim());
    setRenamingId(null);
  }

  return (
    <div className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
      <div className="sidebar-logo">
        <img src="/mosaic-icon.png" alt="" className="logo-mark" />
        <span className="logo-text">mosaic</span>
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <div className="sidebar-section-label">Workspaces</div>

      <div className="workspace-list">
        {workspaces.map((ws, index) => {

          return (
            <div
              key={ws.id}
              className={`workspace-item ${ws.id === activeId && view === "workspace" ? "workspace-active" : ""} ${drag?.index === index ? "workspace-dragging" : ""} ${showInsert && insertIndex === index ? "workspace-insert-before" : ""} ${showInsert && insertIndex === workspaces.length && index === workspaces.length - 1 ? "workspace-insert-after" : ""}`}
              data-workspace-index={index}
              onClick={() => {
                if (didDragRef.current) { didDragRef.current = false; return; }
                onSelect(ws.id);
              }}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button, input")) return;
                e.preventDefault();
                dragSourceRef.current = index;
                insertIndexRef.current = index;
                dragStartYRef.current = e.clientY;
                movedRef.current = false;
              }}
              title={collapsed ? ws.name : undefined}
            >
              {(() => {
                const metas = ws.panels.filter((p) => p.type !== "launcher").flatMap((p) => p.tabs.map((t) => tabMeta[t.id]));
                const terminals = metas.filter((m) => m?.status === "terminal").length;
                const agents = metas.filter((m) => m?.status === "running").length;
                const waiting = metas.filter((m) => m?.status === "attention").length;
                return <span className="workspace-counts">
                  <span
                    className={`workspace-count ${terminals ? "" : "is-empty"}`}
                    style={countStyle("terminal")}
                    title={`${terminals} running terminal sessions`}
                  >
                    <strong>{terminals}</strong>
                  </span>
                  <span
                    className={`workspace-count ${agents ? "" : "is-empty"}`}
                    style={countStyle("running")}
                    title={`${agents} working agent sessions`}
                  >
                    <strong>{agents}</strong>
                  </span>
                  {waiting > 0 && <span
                    className="workspace-count is-alert"
                    style={countStyle("attention")}
                    title={`${waiting} agent sessions needing attention`}
                  >
                    <strong>{waiting}</strong>
                  </span>}
                </span>;
              })()}
              {renamingId === ws.id ? (
                <input
                  className="workspace-rename-input"
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(ws.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(ws.id);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="workspace-short-name" aria-hidden="true">
                    {workspaceInitials(ws.name)}
                  </span>
                  <span
                    className="workspace-name"
                    onDoubleClick={() => startRename(ws)}
                  >
                    {ws.name}
                  </span>
                  <button
                    className={`ws-more ${menuId === ws.id ? "ws-more-open" : ""}`}
                    title="Workspace options"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === ws.id ? null : ws.id);
                    }}
                  >
                    ⋯
                  </button>
                  {menuId === ws.id && (
                    <div className="ws-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMenuId(null); onExport(ws); }}>Export</button>
                      <button onClick={() => { setMenuId(null); startRename(ws); }}>Rename</button>
                      {workspaces.length > 1 && (
                        <button className="ws-menu-danger" onClick={() => { setMenuId(null); onDelete(ws.id); }}>
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {(() => {
        const metas = Object.values(tabMeta);
        const terminals = metas.filter((m) => m.status === "terminal").length;
        const agents = metas.filter((m) => m.status === "running").length;
        const waiting = metas.filter((m) => m.status === "attention").length;
        return (
          <div
            className={`workspace-item workspace-all ${view === "all" ? "workspace-active" : ""}`}
            onClick={onAllRunning}
            title={collapsed ? "All running" : "Every running server and agent, in one workspace"}
          >
            <span className="workspace-counts">
              <span className={`workspace-count ${terminals ? "" : "is-empty"}`} style={countStyle("terminal")} title={`${terminals} running terminal sessions`}>
                <strong>{terminals}</strong>
              </span>
              <span className={`workspace-count ${agents ? "" : "is-empty"}`} style={countStyle("running")} title={`${agents} working agent sessions`}>
                <strong>{agents}</strong>
              </span>
              {waiting > 0 && <span className="workspace-count is-alert" style={countStyle("attention")} title={`${waiting} agent sessions needing attention`}>
                <strong>{waiting}</strong>
              </span>}
            </span>
            <span className="workspace-short-name" aria-hidden="true">∗</span>
            <span className="workspace-name">All running</span>
          </div>
        );
      })()}

      <button
        className={`commands-nav-btn ${view === "commands" ? "commands-nav-active" : ""}`}
        onClick={onCommands}
        title="Command database"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
        <span className="sidebar-action-label">Commands</span>
      </button>

      <button
        className={`commands-nav-btn ${view === "fieldnotes" ? "commands-nav-active" : ""}`}
        onClick={onFieldnotes}
        title="Field notes · client checklists"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h12l4 4v12H4z" />
          <path d="M8 12l2.5 2.5L16 9" />
        </svg>
        <span className="sidebar-action-label">Field notes</span>
      </button>

      <button className="add-workspace-btn" onClick={handleAdd}>
        <span className="sidebar-action-icon">+</span><span className="sidebar-action-label">New workspace</span>
      </button>

      <input
        ref={importInputRef}
        type="file"
        accept=".zip,.mosaic.zip,.json,.mosaic.json,application/zip,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <button className="import-workspace-btn" onClick={() => importInputRef.current?.click()}>
        <span className="sidebar-action-icon">↑</span><span className="sidebar-action-label">Import workspace</span>
      </button>

      <div className="sidebar-footer">
      <button className="settings-btn" onClick={onSettings} title="Settings">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span className="sidebar-action-label">Settings</span>
      </button>

      <button className="help-btn" onClick={onHelp} title="What's this">
        <span className="help-icon">?</span>
        <span className="sidebar-action-label">What's this</span>
      </button>

      <button className="about-btn" onClick={onAbout} title="Caveman Creative">
        <img src="/cc-logo.svg" alt="" className="about-btn-logo" />
        <span className="sidebar-action-label">Caveman Creative</span>
      </button>
      </div>

      {drag && workspaces[drag.index] && createPortal(
        <div className="workspace-drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <span className="grip-dots">⠿</span>
          <span>{workspaces[drag.index].name}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
