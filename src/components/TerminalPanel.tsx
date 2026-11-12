import Icon from "./Icon";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Panel, Tab } from "../types";
import { agentBadge, STATUS_COLORS, STATUS_LABELS, TabMeta } from "../lib/agents";
import { pushUndo } from "../store/undo";
import { restoreTab } from "../store/workspaces";
import Terminal, { TerminalHandle } from "./Terminal";
import CommandToolbox from "./CommandToolbox";
import "./TerminalPanel.css";

interface Props {
  panel: Panel;
  panelIndex: number;
  tabMeta: Record<string, TabMeta>;
  onReorderStart: (index: number, x: number, y: number) => void;
  onUpdate: (panel: Panel) => void;
  onClosePanel: () => void;
}

// When each tab entered its current status, so the pane can say how long it has been there.
const statusSince = new Map<string, { status: string; at: number }>();
export const PANE_STATUS_LABEL: Record<string, string> = { running: "Working", attention: "Needs you", ready: "Done", terminal: "Running", idle: "Idle" };

export function sinceFor(tabId: string, status: string): number {
  const cur = statusSince.get(tabId);
  if (cur && cur.status === status) return cur.at;
  const at = Date.now();
  statusSince.set(tabId, { status, at });
  return at;
}

export function elapsed(status: string, at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (status === "idle" || status === "ready") {
    return `since ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  if (status === "attention") return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function TerminalPanel({ panel, panelIndex, tabMeta, onReorderStart, onUpdate, onClosePanel }: Props) {
  const activeTab = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(activeTab ? [activeTab.id] : []));
  useEffect(() => {
    if (!activeTab) return;
    setMountedTabs((prev) => {
      if (prev.has(activeTab.id)) return prev;
      const next = new Set(prev);
      next.add(activeTab.id);
      return next;
    });
  }, [activeTab?.id]);
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
    const index = panel.tabs.findIndex((t) => t.id === tabId);
    const tab = panel.tabs[index];
    // The shell stays alive until the undo window closes.
    pushUndo(
      `Closed tab "${tab.title}"`,
      () => restoreTab(panel.id, index, tab),
      () => { invoke("pty_kill", { id: tabId }).catch(console.error); },
    );
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
        <button
          className="panel-drag-grip"
          title="Drag to reorder panel"
          onPointerDown={(e) => {
            e.preventDefault();
            onReorderStart(panelIndex, e.clientX, e.clientY);
          }}
        >
          <Icon name="grip" className="grip-dots" />
        </button>
        {panel.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === panel.activeTabId}
            meta={tabMeta[tab.id]}
            onSelect={() => onUpdate({ ...panel, activeTabId: tab.id })}
            onClose={() => closeTab(tab.id)}
            onRename={(title) => renameTab(tab.id, title)}
          />
        ))}
        <button className="tab-add" onClick={addTab} title="New tab">
          <Icon name="plus" size={13} />
        </button>
        <div className="tab-bar-spacer" />
        <button
          className="toolbox-btn"
          onClick={() => setToolboxOpen(true)}
          title="Command toolbox"
        >
          <Icon name="box" />
        </button>
        <button
          className="clear-btn"
          onClick={clearActiveTerminal}
          title="Clear terminal"
        >
          <Icon name="erase" />
        </button>
        <button
          className={`folder-pin-btn ${savedPath ? "folder-pin-active" : ""}`}
          onClick={pickFolder}
          title={savedPath ? `Pinned: ${savedPath}\nClick to change` : "Pin a start folder"}
        >
          {shortPath ? (
            <span className="folder-pin-label">
              <Icon name="home" size={12} className="folder-pin-icon" />
              <span className="folder-pin-text">{shortPath}</span>
            </span>
          ) : (
            <span className="folder-pin-label">
              <Icon name="home" size={12} className="folder-pin-icon" />
              <span className="folder-pin-text">set folder</span>
            </span>
          )}
        </button>
        <button
          className="tab-bar-close-btn"
          onClick={onClosePanel}
          title="Close panel"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="terminal-body">
        {panel.tabs.filter((tab) => mountedTabs.has(tab.id) || tab.id === activeTab?.id).map((tab) => (
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
      {(() => {
        // The footer speaks for the most urgent tab in the pane.
        const rank = ["attention", "running", "ready", "terminal", "idle"];
        const tabs = panel.tabs.map((t) => ({ t, status: tabMeta[t.id]?.status ?? "idle" }));
        tabs.forEach(({ t, status }) => sinceFor(t.id, status));
        const lead = tabs.slice().sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0];
        const agents = tabs.filter(({ t }) => tabMeta[t.id]?.agent).length;
        return (
          <div className={`pane-status pane-status-${lead.status}`}>
            <span className="pane-status-info">
              {panel.tabs.length} {panel.tabs.length === 1 ? "shell" : "shells"}
              {agents > 0 && ` · ${agents} ${agents === 1 ? "agent" : "agents"}`}
            </span>
            <span className="pane-status-state">
              <b>{PANE_STATUS_LABEL[lead.status]}</b> {elapsed(lead.status, sinceFor(lead.t.id, lead.status))}
            </span>
          </div>
        );
      })()}
      {toolboxOpen && (
        <CommandToolbox onClose={() => setToolboxOpen(false)} />
      )}
    </div>
  );
}

function TabItem({
  tab,
  active,
  meta,
  onSelect,
  onClose,
  onRename,
}: {
  tab: Tab;
  active: boolean;
  meta?: TabMeta;
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

  const status = meta?.status ?? "idle";
  const badge = meta ? agentBadge(meta.agent) : null;

  return (
    <div className={`tab-item tab-status-${status} ${active ? "tab-active" : ""}`} style={{ "--tab-status": STATUS_COLORS[status] } as CSSProperties} title={`${STATUS_LABELS[status]} · double-click to rename`} onClick={onSelect} onDoubleClick={(e) => { e.stopPropagation(); setDraft(tab.title); setEditing(true); }}>
      {!badge && <span className="tab-shell-glyph">$</span>}
      {badge && (badge.logo ?
        <img className="tab-agent-logo" src={badge.logo} alt={badge.name} title={badge.name} /> :
        <span className="tab-agent-name" title={badge.name}>{badge.name}</span>
      )}
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
        <span className="tab-title">
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
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}
