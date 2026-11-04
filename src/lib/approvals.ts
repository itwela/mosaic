import { invoke } from "@tauri-apps/api/core";
import { AgentStatus, Panel, Workspace } from "../types";
import { TabMeta } from "./agents";

// Write an approval, denial, or reply into the agent's own PTY. The existing
// `pty_write` command is the whole transport: Mosaic does not click the
// agent's UI, it types the choice that is on screen. The input event lets
// status drop the red as soon as the answer is sent.
export async function answerAgent(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
  window.dispatchEvent(new CustomEvent("mosaic-agent-input", { detail: { id, at: Date.now() } }));
}

export function ago(at: number): string {
  const minutes = Math.max(0, Date.now() - at) / 60000;
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface WorkspaceCounts {
  terminals: number;
  working: number;
  ready: number;
  attention: number;
}

const EMPTY: WorkspaceCounts = { terminals: 0, working: 0, ready: 0, attention: 0 };

function tally(status: AgentStatus, counts: WorkspaceCounts) {
  if (status === "terminal") counts.terminals += 1;
  else if (status === "running") counts.working += 1;
  else if (status === "ready") counts.ready += 1;
  else if (status === "attention") counts.attention += 1;
}

export function countPanels(panels: Panel[], tabMeta: Record<string, TabMeta>): WorkspaceCounts {
  const counts = { ...EMPTY };
  for (const panel of panels) {
    if (panel.type && panel.type !== "terminal") continue;
    for (const tab of panel.tabs) tally(tabMeta[tab.id]?.status ?? "idle", counts);
  }
  return counts;
}

export function countWorkspace(ws: Workspace, tabMeta: Record<string, TabMeta>): WorkspaceCounts {
  return countPanels(ws.panels, tabMeta);
}

export function countAll(workspaces: Workspace[], tabMeta: Record<string, TabMeta>): WorkspaceCounts {
  const counts = { ...EMPTY };
  for (const ws of workspaces) {
    const next = countWorkspace(ws, tabMeta);
    counts.terminals += next.terminals;
    counts.working += next.working;
    counts.ready += next.ready;
    counts.attention += next.attention;
  }
  return counts;
}

export type Tone = "idle" | "terminal" | "running" | "ready" | "attention";

export const TONE: Record<Tone, string> = {
  idle: "#3B3227",
  terminal: "#F3E2C4",
  running: "#FFB547",
  ready: "#7C9BFF",
  attention: "#FF4A3D",
};

export function statusTone(status: AgentStatus | undefined): Tone {
  if (status === "terminal" || status === "running" || status === "ready" || status === "attention") return status;
  return "idle";
}

export function workspaceTone(counts: WorkspaceCounts): Tone {
  if (counts.attention) return "attention";
  if (counts.working) return "running";
  if (counts.ready) return "ready";
  if (counts.terminals) return "terminal";
  return "idle";
}

export interface AttentionTarget {
  workspaceId: string;
  workspaceName: string;
  panelId: string;
  tabId: string;
  tabTitle: string;
  agent: string | null;
  prompt: string;
  approve: string;
  deny: string;
  at: number;
}

// Approvals waiting in workspaces other than the one on screen, newest first.
// `at` is when that tab's screen last published the prompt; tabs that became
// attention without a screen reading sort last.
const seenAt = new Map<string, number>();

export function incomingApprovals(
  workspaces: Workspace[],
  tabMeta: Record<string, TabMeta>,
  currentId: string,
): AttentionTarget[] {
  const list: AttentionTarget[] = [];
  const live = new Set<string>();
  for (const ws of workspaces) {
    if (ws.id === currentId) continue;
    for (const panel of ws.panels) {
      if (panel.type && panel.type !== "terminal") continue;
      for (const tab of panel.tabs) {
        const meta = tabMeta[tab.id];
        if (meta?.status !== "attention" || !meta.approval) continue;
        live.add(tab.id);
        if (!seenAt.has(tab.id)) seenAt.set(tab.id, Date.now());
        list.push({
          workspaceId: ws.id,
          workspaceName: ws.name,
          panelId: panel.id,
          tabId: tab.id,
          tabTitle: tab.title,
          agent: meta.agent,
          prompt: meta.approval.prompt,
          approve: meta.approval.approve,
          deny: meta.approval.deny,
          at: seenAt.get(tab.id) ?? Date.now(),
        });
      }
    }
  }
  for (const id of [...seenAt.keys()]) if (!live.has(id)) seenAt.delete(id);
  list.sort((a, b) => b.at - a.at);
  return list;
}
