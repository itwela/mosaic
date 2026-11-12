import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Tab, Workspace } from "../types";
import { agentBadge, STATUS_COLORS, STATUS_LABELS, TabMeta } from "../lib/agents";
import { adoptTerminal, releaseTerminal } from "./Terminal";
import { elapsed, PANE_STATUS_LABEL, sinceFor } from "./TerminalPanel";
import { GLASS_COLORS } from "./Sidebar";
import Icon from "./Icon";
import { useNarrow } from "../lib/useNarrow";
import "./AllRunningView.css";

interface Props {
  workspaces: Workspace[];
  tabMeta: Record<string, TabMeta>;
  onOpenWorkspace: (id: string) => void;
  onToggleScreenshot?: () => void;
}

interface Entry {
  tab: Tab;
  workspace: Workspace;
}

// Every terminal that's doing something (a server, a build, an agent) from
// every workspace, in one grid. The terminals aren't copies: each slot borrows
// the real xterm element from its home workspace and returns it on unmount.
export default function AllRunningView({ workspaces, tabMeta, onOpenWorkspace, onToggleScreenshot }: Props) {
  // Once a terminal shows up it stays while this view is open, so a server
  // that briefly goes quiet doesn't make the grid jump around.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const all = useMemo(() => {
    const list: Entry[] = [];
    for (const workspace of workspaces) {
      for (const panel of workspace.panels) {
        if (panel.type === "launcher" || panel.type === "usage" || panel.type === "fieldnotes" || panel.type === "zen") continue;
        for (const tab of panel.tabs) list.push({ tab, workspace });
      }
    }
    return list;
  }, [workspaces]);

  useEffect(() => {
    const busy = all.filter(({ tab }) => {
      const status = tabMeta[tab.id]?.status ?? "idle";
      return status !== "idle";
    });
    setPinned((cur) => {
      if (busy.every(({ tab }) => cur.has(tab.id))) return cur;
      const next = new Set(cur);
      for (const { tab } of busy) next.add(tab.id);
      return next;
    });
  }, [all, tabMeta]);

  const entries = all.filter(({ tab }) => pinned.has(tab.id));
  const narrow = useNarrow();
  const cols = narrow ? 1 : Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const statuses = entries.map(({ tab }) => tabMeta[tab.id]?.status ?? "idle");
  const working = statuses.filter((x) => x === "running").length;
  const waiting = statuses.filter((x) => x === "attention").length;
  // Keep the footers' timers moving.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  return (
    <div className="all-running">
      <div className="grid-toolbar" data-tauri-drag-region>
        <span className="grid-workspace-name">All running</span>
        <span className="grid-summary">
          <span>{entries.length} terminal{entries.length === 1 ? "" : "s"}</span>
          {working > 0 && <span className="grid-summary-working">{working}<i> working</i></span>}
          {waiting > 0 && <span className="grid-summary-waiting">{waiting}<i> {waiting === 1 ? "needs you" : "need you"}</i></span>}
        </span>
        {onToggleScreenshot && (
          <div className="grid-toolbar-actions all-running-actions">
            <button className="grid-tuck-btn" onClick={onToggleScreenshot} title="Tuck to corner (⌘⇧S)">
              <Icon name="tuck" />tuck
            </button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="all-running-empty">
          Nothing is running yet. Start a server or an agent in any workspace and it shows up here.
        </div>
      ) : (
        <div className={`all-running-grid ${narrow ? "all-running-stack" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {entries.map(({ tab, workspace }) => (
            <Slot
              key={tab.id}
              tab={tab}
              workspace={workspace}
              meta={tabMeta[tab.id]}
              glass={GLASS_COLORS[workspaces.indexOf(workspace) % GLASS_COLORS.length]}
              onOpenWorkspace={() => onOpenWorkspace(workspace.id)}
            />
          ))}
          {/* a place left over in the last row stays open glass, softly lit */}
          {entries.length % cols !== 0 && <div className="all-slot-open" data-glass-light="none 0.55 30" />}
        </div>
      )}
    </div>
  );
}

function Slot({ tab, workspace, meta, glass, onOpenWorkspace }: { tab: Tab; workspace: Workspace; meta?: TabMeta; glass: string; onOpenWorkspace: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const status = meta?.status ?? "idle";
  const badge = meta ? agentBadge(meta.agent) : null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    adoptTerminal(tab.id, host);
    // A panel reorder remounts the home terminal with a new element; follow it.
    const onLive = (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail.id === tab.id) adoptTerminal(tab.id, host);
    };
    window.addEventListener("mosaic-terminal-live", onLive);
    return () => {
      window.removeEventListener("mosaic-terminal-live", onLive);
      releaseTerminal(tab.id, host);
    };
  }, [tab.id]);

  return (
    <div
      className={`all-slot tab-status-${status}`}
      style={{ "--tab-status": STATUS_COLORS[status] } as CSSProperties}
      data-pane-status={status}
      data-glass-status={status}
    >
      <div className="all-slot-head" title={STATUS_LABELS[status]}>
        <div className="all-slot-tab">
          <span className="all-slot-dot" />
          {badge?.logo ? <img className="tab-agent-logo" src={badge.logo} alt={badge.name} /> : <span className="tab-shell-glyph">$</span>}
          <span className="all-slot-title">{tab.title}</span>
        </div>
        <button className="all-slot-ws" data-glass={glass} onClick={onOpenWorkspace} title={`Open ${workspace.name}`}>
          <i className="all-slot-ws-chip" />
          <span>{workspace.name}</span>
          <Icon name="out" size={11} />
        </button>
      </div>
      <div className="all-slot-body" ref={hostRef} />
      <div className="all-slot-state">
        <b>{PANE_STATUS_LABEL[status]}</b> {elapsed(status, sinceFor(tab.id, status))}
      </div>
    </div>
  );
}
