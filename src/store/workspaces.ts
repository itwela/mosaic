import { v4 as uuidv4 } from "uuid";
import { LaunchItem, Panel, Tab, Workspace } from "../types";
import { insertAt } from "./undo";

const STORAGE_KEY = "mosaic-workspaces";

export interface WorkspaceBundle {
  format: "mosaic-workspace";
  version: 2;
  exportedAt: string;
  workspace: Workspace;
  embeddedFiles?: EmbeddedFile[];
}

export interface EmbeddedFile {
  originalPath: string;
  name: string;
  data: string;
}

export function makeTab(title = "shell"): Tab {
  return { id: uuidv4(), title };
}

export function makePanel(): Panel {
  const tab = makeTab();
  return { id: uuidv4(), type: "terminal", tabs: [tab], activeTabId: tab.id };
}

export function makeLauncherPanel(): Panel {
  return { id: uuidv4(), type: "launcher", tabs: [], activeTabId: "", launchItems: [] };
}

export function makeUsagePanel(): Panel {
  return { id: uuidv4(), type: "usage", tabs: [], activeTabId: "" };
}

export function makeWorkspace(name: string, panelCount = 4): Workspace {
  const panels = Array.from({ length: panelCount }, makePanel);
  return {
    id: uuidv4(),
    name,
    panels,
    layout: panels.map(() => 100 / panelCount),
  };
}

export function freshIds(ws: Workspace): Workspace {
  return {
    ...ws,
    panels: ws.panels.map((panel) => {
      if (panel.type === "launcher" || panel.tabs.length === 0) {
        return { ...panel, id: uuidv4() };
      }
      const tabs = panel.tabs.map((tab) => ({ ...tab, id: uuidv4() }));
      return { ...panel, id: uuidv4(), tabs, activeTabId: tabs[0].id };
    }),
  };
}

export function createWorkspaceBundle(workspace: Workspace, embeddedFiles: EmbeddedFile[] = []): WorkspaceBundle {
  return {
    format: "mosaic-workspace",
    version: 2,
    exportedAt: new Date().toISOString(),
    workspace,
    embeddedFiles,
  };
}

export function parseWorkspaceBundle(raw: unknown): Workspace {
  if (!raw || typeof raw !== "object") throw new Error("This file is not a Mosaic workspace.");
  const bundle = raw as Partial<WorkspaceBundle>;
  if (bundle.format !== "mosaic-workspace" || ![1, 2].includes(bundle.version ?? 0) || !bundle.workspace) {
    throw new Error("This file is not a compatible Mosaic workspace export.");
  }

  const workspace = bundle.workspace;
  if (typeof workspace.name !== "string" || !Array.isArray(workspace.panels) || !Array.isArray(workspace.layout)) {
    throw new Error("The workspace export is missing required layout data.");
  }

  return freshIds(workspace);
}

export function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved: Workspace[] = JSON.parse(raw);
      // Re-generate all tab/panel IDs so stale PTY events from the last session
      // don't bleed into new terminals that happen to share the same ID.
      return saved.map(freshIds);
    }
  } catch {}
  return [makeWorkspace("Workspace 1")];
}

export function saveWorkspaces(workspaces: Workspace[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
}

// Undo restores run long after the component that deleted something rendered,
// so they go through App's state setter instead of a stale `onUpdate` closure.
type WorkspacesUpdater = (fn: (ws: Workspace[]) => Workspace[]) => void;
let mutator: WorkspacesUpdater | null = null;

export function setWorkspaceMutator(m: WorkspacesUpdater | null) {
  mutator = m;
}

function mapPanel(panelId: string, fn: (p: Panel) => Panel) {
  mutator?.((wss) => wss.map((w) =>
    w.panels.some((p) => p.id === panelId)
      ? { ...w, panels: w.panels.map((p) => (p.id === panelId ? fn(p) : p)) }
      : w
  ));
}

export function restorePanel(workspaceId: string, index: number, panel: Panel) {
  mutator?.((wss) => wss.map((w) => (w.id === workspaceId ? { ...w, panels: insertAt(w.panels, index, panel) } : w)));
}

export function restoreTab(panelId: string, index: number, tab: Tab) {
  mapPanel(panelId, (p) => ({ ...p, tabs: insertAt(p.tabs, index, tab), activeTabId: tab.id }));
}

export function restoreLaunchItem(panelId: string, index: number, item: LaunchItem) {
  mapPanel(panelId, (p) => ({ ...p, launchItems: insertAt(p.launchItems ?? [], index, item) }));
}
