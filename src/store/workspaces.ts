import { v4 as uuidv4 } from "uuid";
import { Panel, Tab, Workspace } from "../types";

const STORAGE_KEY = "mosaic-workspaces";

export interface WorkspaceBundle {
  format: "mosaic-workspace";
  version: 1;
  exportedAt: string;
  workspace: Workspace;
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
      if (panel.type === "launcher") {
        return { ...panel, id: uuidv4() };
      }
      const tabs = panel.tabs.map((tab) => ({ ...tab, id: uuidv4() }));
      return { ...panel, id: uuidv4(), tabs, activeTabId: tabs[0].id };
    }),
  };
}

export function createWorkspaceBundle(workspace: Workspace): WorkspaceBundle {
  return {
    format: "mosaic-workspace",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace,
  };
}

export function parseWorkspaceBundle(raw: unknown): Workspace {
  if (!raw || typeof raw !== "object") throw new Error("This file is not a Mosaic workspace.");
  const bundle = raw as Partial<WorkspaceBundle>;
  if (bundle.format !== "mosaic-workspace" || bundle.version !== 1 || !bundle.workspace) {
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
