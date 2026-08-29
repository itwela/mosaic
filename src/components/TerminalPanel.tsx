import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { open } from "@tauri-apps/plugin-dialog";
import { Panel, SavedCommand, Tab } from "../types";
import Terminal, { TerminalHandle } from "./Terminal";
import CommandToolbox from "./CommandToolbox";
import "./TerminalPanel.css";

interface Props {
  panel: Panel;
  onUpdate: (panel: Panel) => void;
  onClosePanel: () => void;
}

export default function TerminalPanel({ panel, onUpdate, onClosePanel }: Props) {
  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];
  const termRefs = useRef<Map<string, TerminalHandle>>(new Map());
  const [toolboxOpen, setToolboxOpen] = useState(false);

  function clearActiveTerminal() {
    termRefs.current.get(activeTab.id)?.clear();
  }

  function addTab() {
    // inherit the active tab's saved cwd when creating a new tab in the same panel
    const tab: Tab = { id: uuidv4(), title: "shell", cwd: activeTab?.cwd };
    onUpdate({ ...panel, tabs: [...panel.tabs, tab], activeTabId: tab.id });
  }

  function closeTab(tabId: string) {
    if (panel.tabs.length === 1) return;
    const remaining = panel.tabs.filter((t) => t.id !== tabId);
    const newActive =
      panel.activeTabId === tabId
        ? remaining[remaining.length - 1].id
        : panel.activeTabId;
    onUpdate({ ...panel, tabs: remaining, activeTabId: newActive });
  }

  function renameTab(tabId: string, title: string) {
    onUpdate({
      ...panel,
      tabs: panel.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
    });
  }

  function setCwd(tabId: string, cwd: string) {
    onUpdate({
      ...panel,
      tabs: panel.tabs.map((t) => (t.id === tabId ? { ...t, cwd } : t)),
    });
  }

  function addSavedCommand(cmd: SavedCommand) {
    onUpdate({
      ...panel,
      tabs: panel.tabs.map((t) =>
        t.id === activeTab.id ? { ...t, savedCommands: [...(t.savedCommands ?? []), cmd] } : t
      ),
    });
  }

  function deleteSavedCommand(id: string) {
    onUpdate({
      ...panel,
      tabs: panel.tabs.map((t) =>
        t.id === activeTab.id
          ? { ...t, savedCommands: (t.savedCommands ?? []).filter((c) => c.id !== id) }
          : t
      ),
    });
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      setCwd(activeTab.id, selected);
    }
  }

  const savedPath = activeTab?.cwd;
  const shortPath = savedPath
    ? savedPath.replace(/^\/Users\/[^/]+/, "~")
    : null;

  return (
    <div className="terminal-panel">
      <div className="tab-bar">
        {panel.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === panel.activeTabId}
            onSelect={() => onUpdate({ ...panel, activeTabId: tab.id })}
            onClose={() => closeTab(tab.id)}
            onRename={(title) => renameTab(tab.id, title)}
          />
        ))}
        <button className="tab-add" onClick={addTab} title="New tab">
          +
        </button>
        <div className="tab-bar-spacer" />
        <button
          className="toolbox-btn"
          onClick={() => setToolboxOpen(true)}
          title="Command toolbox"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" />
            <path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
            <path d="M2 13h20" />
            <path d="M10 13v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-2" />
          </svg>
        </button>
        <button
          className="clear-btn"
          onClick={clearActiveTerminal}
          title="Clear terminal"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
            <path d="M22 21H7"/>
            <path d="m5 11 9 9"/>
          </svg>
        </button>
        <button
          className={`folder-pin-btn ${savedPath ? "folder-pin-active" : ""}`}
          onClick={pickFolder}
          title={savedPath ? `Pinned: ${savedPath}\nClick to change` : "Pin a start folder"}
        >
          {shortPath ? (
            <span className="folder-pin-label">
              <span className="folder-pin-icon">⌂</span>
              <span className="folder-pin-text">{shortPath}</span>
            </span>
          ) : (
            <span className="folder-pin-label">
              <span className="folder-pin-icon">⌂</span>
              <span className="folder-pin-text">set folder</span>
            </span>
          )}
        </button>
        <button
          className="tab-bar-close-btn"
          onClick={onClosePanel}
          title="Close panel"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="terminal-body">
        {panel.tabs.map((tab) => (
          <div
            key={tab.id}
            className="terminal-slot"
            style={{ display: tab.id === activeTab.id ? "flex" : "none" }}
          >
            <Terminal
              ref={(handle) => {
                if (handle) termRefs.current.set(tab.id, handle);
                else termRefs.current.delete(tab.id);
              }}
              id={tab.id}
              active={tab.id === activeTab.id}
              cwd={tab.cwd}
            />
          </div>
        ))}
      </div>
      {toolboxOpen && (
        <CommandToolbox
          tabTitle={activeTab.title}
          commands={activeTab.savedCommands ?? []}
          onClose={() => setToolboxOpen(false)}
          onAdd={addSavedCommand}
          onDelete={deleteSavedCommand}
        />
      )}
    </div>
  );
}

function TabItem({
  tab,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  tab: Tab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);

  function commitRename() {
    setEditing(false);
    if (draft.trim()) onRename(draft.trim());
    else setDraft(tab.title);
  }

  return (
    <div className={`tab-item ${active ? "tab-active" : ""}`} onClick={onSelect}>
      {editing ? (
        <input
          className="tab-rename-input"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(tab.title);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tab-title" onDoubleClick={() => setEditing(true)}>
          {tab.title}
        </span>
      )}
      <button
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
