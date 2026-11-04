import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Tab, Workspace } from "../types";
import { agentBadge, STATUS_COLORS, STATUS_LABELS, TabMeta } from "../lib/agents";
import { countAll, statusTone, TONE, workspaceTone, countWorkspace } from "../lib/approvals";
import { adoptTerminal, releaseTerminal } from "./Terminal";
import StatusRing from "./StatusRing";
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
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(entries.length, 1))));
  const counts = countAll(workspaces, tabMeta);
  const arcs = entries.map(({ tab }) => TONE[statusTone(tabMeta[tab.id]?.status)]);
  const inner = workspaces.map((ws) => TONE[workspaceTone(countWorkspace(ws, tabMeta))]);
  const live = counts.terminals + counts.working + counts.ready + counts.attention;

  return (
    <div className="all-running">
      <section className="all-core">
        <i className="brk tl" /><i className="brk tr" /><i className="brk bl" /><i className="brk br" />
        <div className="lbl">Fig.01 — agent core · all workspaces</div>
        <StatusRing arcs={arcs} inner={inner} center={live} label="LIVE" size={280} />
        <div className="all-core-stats">
          <div><div className="num ca" style={{ color: "var(--amb)" }}>{counts.working.toString().padStart(2, "0")}</div><div className="lbl" style={{ color: "var(--amb)" }}>Working</div></div>
          <div><div className="num ca" style={{ color: "var(--ruby)" }}>{counts.attention.toString().padStart(2, "0")}</div><div className="lbl" style={{ color: "var(--ruby)" }}>Need you</div></div>
          <div><div className="num ca">{counts.ready.toString().padStart(2, "0")}</div><div className="lbl">Ready</div></div>
        </div>
        <div className="all-core-note">Hover a terminal to focus it · click the workspace name to jump there</div>
      </section>
      <div className="all-running-main">
        <div className="all-running-head">
          <h1 className="big ca">All running</h1>
          <span className="all-running-count">{entries.length} terminal{entries.length === 1 ? "" : "s"}</span>
        </div>
        {entries.length === 0 ? (
          <div className="all-running-empty">
            Nothing is running yet. Start a server or an agent in any workspace and it shows up here.
          </div>
        ) : (
          <div className="all-running-grid" style={{ gridTemplateColumns: `repeat(${Math.min(cols, 2)}, minmax(0, 1fr))` }}>
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
