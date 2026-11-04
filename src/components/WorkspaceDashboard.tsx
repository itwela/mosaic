import { useState } from "react";
import { Workspace } from "../types";
import { agentBadge, TabMeta } from "../lib/agents";
import { ago, answerAgent, AttentionTarget, countWorkspace, incomingApprovals, statusTone, TONE, workspaceTone } from "../lib/approvals";
import { FieldnotesProgress } from "../lib/fieldnotesProgress";
import StatusRing from "./StatusRing";

interface Props {
  workspace: Workspace;
  workspaces: Workspace[];
  tabMeta: Record<string, TabMeta>;
  notes: FieldnotesProgress;
  onOpen: (target: AttentionTarget) => void;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function Meter({ done, active, total, cells }: { done: number; active: number; total: number; cells: number }) {
  const doneCells = total > 0 ? Math.round((done / total) * cells) : 0;
  const activeCells = total > 0 ? Math.min(cells - doneCells, Math.round((active / total) * cells)) : 0;
  return (
    <div className="meter" aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < doneCells ? "on" : i < doneCells + activeCells ? "hot" : ""} />
      ))}
    </div>
  );
}

export default function WorkspaceDashboard({ workspace, workspaces, tabMeta, notes, onOpen }: Props) {
  const counts = countWorkspace(workspace, tabMeta);
  const incoming = incomingApprovals(workspaces, tabMeta, workspace.id);
  const [cursor, setCursor] = useState(0);
  const index = incoming.length ? cursor % incoming.length : 0;
  const item = incoming[index];
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");

  const arcs: string[] = [];
  for (const panel of workspace.panels) {
    if (panel.type && panel.type !== "terminal") continue;
    for (const tab of panel.tabs) {
      const tone = statusTone(tabMeta[tab.id]?.status);
      if (tone === "idle") continue;
      arcs.push(TONE[tone]);
    }
  }
  const inner = workspaces.map((ws) => TONE[workspaceTone(countWorkspace(ws, tabMeta))]);
  // The center figure is the three numbers beside it. Shell sessions are a
  // sidebar chip, not one of these categories, so they do not inflate the ring.
  const live = counts.working + counts.attention + counts.ready;

  async function answer(kind: "approve" | "deny") {
    if (!item || busy) return;
    setBusy(kind);
    setError("");
    try {
      await answerAgent(item.tabId, kind === "approve" ? item.approve : item.deny);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const badge = item ? agentBadge(item.agent) : null;

  return (
    <div className="dash">
      <section className="dash-core">
        <StatusRing arcs={arcs} inner={inner} center={live} label="THIS WORKSPACE" />
        <div className="dash-stats">
          <div><span className="num ca" style={{ color: "var(--amb)" }}>{pad(counts.working)}</span> <span className="lbl" style={{ color: "var(--amb)" }}>Working</span></div>
          <div><span className="num ca" style={{ color: "var(--ruby)" }}>{pad(counts.attention)}</span> <span className="lbl" style={{ color: "var(--ruby)" }}>Need you</span></div>
          <div><span className="num ca" style={{ color: "var(--cob)" }}>{pad(counts.ready)}</span> <span className="lbl" style={{ color: "var(--cob)" }}>Ready</span></div>
        </div>
      </section>

      <section className={`dash-incoming ${item ? "is-waiting" : ""}`}>
        <i className="brk tl" /><i className="brk tr" /><i className="brk bl" /><i className="brk br" />
        <div className="lbl" style={{ color: item ? "var(--ruby)" : undefined }}>
          Incoming · from other workspaces
          {incoming.length > 1 && <span className="incoming-more">{index + 1} of {incoming.length}</span>}
        </div>
        {item ? (
          <>
            <div className="incoming-row">
              <div className="incoming-copy">
                <div className="incoming-title">
                  {item.workspaceName}
                  <span className="incoming-meta"> · {badge?.name ?? item.tabTitle} · {ago(item.at)}</span>
                </div>
                <div className="incoming-prompt">{item.prompt}</div>
              </div>
              <button className="btn pri" disabled={busy !== null} onClick={() => void answer("approve")}>{busy === "approve" ? "Sending" : "Approve ⏎"}</button>
              <button className="btn danger" disabled={busy !== null} onClick={() => void answer("deny")}>{busy === "deny" ? "Sending" : "Deny"}</button>
              <button className="btn" onClick={() => onOpen(item)}>Open ↗</button>
              {incoming.length > 1 && (
                <button className="btn" onClick={() => setCursor((n) => n + 1)} title="Next approval">Next</button>
              )}
            </div>
            <div className="incoming-note">
              {error || "Approving here answers the agent in its own terminal. Nothing else changes."}
            </div>
          </>
        ) : (
          <div className="incoming-empty">
            <div className="incoming-title">Nothing waiting</div>
            <div className="incoming-note">When an agent in another workspace asks for approval, it shows up here. Approving types that answer into its terminal.</div>
          </div>
        )}
      </section>

      <section className="dash-notes">
        <div className="lbl">Field notes{notes.short ? ` · ${notes.short}` : ""}</div>
        {!notes.ready ? (
          <div className="fn-empty">Reading field notes…</div>
        ) : notes.empty ? (
          <div className="fn-empty">No client data on this machine. Add clients in Field notes, or restore my-clients.js on this computer.</div>
        ) : (
          <>
            <div className="fn-num">{notes.done}<span> / {notes.total}</span></div>
            <Meter done={notes.done} active={notes.active} total={notes.total} cells={24} />
            <div className="fn-sub">{notes.active} active · {notes.remaining} remaining</div>
          </>
        )}
      </section>
    </div>
  );
}
