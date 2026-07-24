import { useState } from "react";
import { Workspace } from "../types";
import { makeWorkspace } from "../store/workspaces";
import "./Sidebar.css";

interface UpcomingItem {
  id: string;
  text: string;
  done: boolean;
}

function loadUpcoming(): UpcomingItem[] {
  try {
    const raw = localStorage.getItem("mosaic-upcoming");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

interface Props {
  workspaces: Workspace[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: (ws: Workspace) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onHelp: () => void;
  onAbout: () => void;
}

export default function Sidebar({
  workspaces,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onSettings,
  onHelp,
  onAbout,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>(loadUpcoming);
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState("");

  function saveUpcoming(items: UpcomingItem[]) {
    setUpcoming(items);
    localStorage.setItem("mosaic-upcoming", JSON.stringify(items));
  }

  function toggleDone(id: string) {
    saveUpcoming(upcoming.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function removeTask(id: string) {
    saveUpcoming(upcoming.filter((t) => t.id !== id));
  }

  function commitTask() {
    if (newTask.trim()) {
      saveUpcoming([...upcoming, { id: crypto.randomUUID(), text: newTask.trim(), done: false }]);
    }
    setNewTask("");
    setAddingTask(false);
  }

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
    <div className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-mark">▦</span>
        <span className="logo-text">mosaic</span>
      </div>

      <div className="sidebar-section-label">Workspaces</div>

      <div className="workspace-list">
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={`workspace-item ${ws.id === activeId ? "workspace-active" : ""}`}
            onClick={() => onSelect(ws.id)}
          >
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
                <span
                  className="workspace-name"
                  onDoubleClick={() => startRename(ws)}
                >
                  {ws.name}
                </span>
                <div className="workspace-actions">
                  <button
                    className="ws-action"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(ws);
                    }}
                  >
                    ✎
                  </button>
                  {workspaces.length > 1 && (
                    <button
                      className="ws-action ws-delete"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(ws.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="sidebar-upcoming">
        <div className="upcoming-header">
          <span className="sidebar-section-label" style={{ padding: 0 }}>Upcoming</span>
          <button className="upcoming-add-btn" onClick={() => setAddingTask(true)} title="Add task">+</button>
        </div>

        {upcoming.length === 0 && !addingTask && (
          <div className="upcoming-empty">nothing queued</div>
        )}

        <div className="upcoming-list">
          {upcoming.map((task) => (
            <div key={task.id} className={`upcoming-item ${task.done ? "upcoming-done" : ""}`}>
              <button className="upcoming-check" onClick={() => toggleDone(task.id)}>
                {task.done ? "✓" : "○"}
              </button>
              <span className="upcoming-text">{task.text}</span>
              <button className="upcoming-remove" onClick={() => removeTask(task.id)}>×</button>
            </div>
          ))}
        </div>

        {addingTask && (
          <input
            className="upcoming-input"
            autoFocus
            value={newTask}
            placeholder="add task..."
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTask();
              if (e.key === "Escape") { setNewTask(""); setAddingTask(false); }
            }}
            onBlur={commitTask}
          />
        )}
      </div>

      <button className="add-workspace-btn" onClick={handleAdd}>
        + New workspace
      </button>

      <button className="settings-btn" onClick={onSettings}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        Settings
      </button>

      <button className="help-btn" onClick={onHelp}>
        <span className="help-icon">?</span>
        What's this
      </button>

      <button className="about-btn" onClick={onAbout}>
        <img src="/cc-logo.svg" alt="" className="about-btn-logo" />
        Caveman Creative
      </button>
    </div>
  );
}
