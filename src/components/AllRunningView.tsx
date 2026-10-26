import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Tab, Workspace } from "../types";
import { agentBadge, STATUS_COLORS, STATUS_LABELS, TabMeta } from "../lib/agents";
import { adoptTerminal, releaseTerminal } from "./Terminal";
import "./AllRunningView.css";

interface Props {
  workspaces: Workspace[];
  tabMeta: Record<string, TabMeta>;
  onOpenWorkspace: (id: string) => void;
}

interface Entry {
  tab: Tab;
  workspace: Workspace;
}

// Every terminal that's doing something (a server, a build, an agent) from
// every workspace, in one grid. The terminals aren't copies: each slot borrows
// the real xterm element from its home workspace and returns it on unmount.
export default function AllRunningView({ workspaces, tabMeta, onOpenWorkspace }: Props) {
  // Once a terminal shows up it stays while this view is open, so a server
  // that briefly goes quiet doesn't make the grid jump around.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const all = useMemo(() => {
    const list: Entry[] = [];
    for (const workspace of workspaces) {
      for (const panel of workspace.panels) {
        if (panel.type === "launcher" || panel.type === "usage") continue;
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
  const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length)));

  return (
    <div className="all-running">
      <div className="grid-toolbar">
        <span className="grid-workspace-name">All running · {entries.length} terminal{entries.length === 1 ? "" : "s"}</span>
      </div>
      {entries.length === 0 ? (
        <div className="all-running-empty">
          Nothing is running yet. Start a server or an agent in any workspace and it shows up here.
        </div>
      ) : (
        <div className="all-running-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {entries.map(({ tab, workspace }) => (
            <Slot
              key={tab.id}
              tab={tab}
              workspace={workspace}
              meta={tabMeta[tab.id]}
              onOpenWorkspace={() => onOpenWorkspace(workspace.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Slot({ tab, workspace, meta, onOpenWorkspace }: { tab: Tab; workspace: Workspace; meta?: TabMeta; onOpenWorkspace: () => void }) {
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
    <div className={`all-slot tab-status-${status}`} style={{ "--tab-status": STATUS_COLORS[status] } as CSSProperties}>
      <div className="all-slot-head" title={STATUS_LABELS[status]}>
        <span className="all-slot-dot" />
        {badge?.logo && <img className="tab-agent-logo" src={badge.logo} alt={badge.name} />}
        <span className="all-slot-title">{tab.title}</span>
        <button className="all-slot-ws" onClick={onOpenWorkspace} title={`Open ${workspace.name}`}>
          {workspace.name} ↗
        </button>
      </div>
      <div className="all-slot-body" ref={hostRef} />
    </div>
  );
}
