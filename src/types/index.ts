export interface SavedCommand {
  id: string;
  label?: string;
  text: string;
}

export interface Tab {
  id: string;
  title: string;
  cwd?: string;
  savedCommands?: SavedCommand[];
}

export interface LaunchItem {
  id: string;
  name: string;
  path: string;
  kind?: "file" | "url";
}

export interface Panel {
  id: string;
  type?: "terminal" | "launcher" | "usage";
  // terminal
  tabs: Tab[];
  activeTabId: string;
  // launcher
  name?: string;
  launchItems?: LaunchItem[];
}

export interface Workspace {
  id: string;
  name: string;
  panels: Panel[];
  layout: number[]; // panel size percentages for resizable-panels
}

// Live status of a terminal tab, derived from what its shell is currently
// running. "idle" = just a shell/IDE sitting there, "running" = an agent is
// working, "attention" = an agent is waiting on the user.
export type AgentStatus = "idle" | "ready" | "terminal" | "running" | "attention";
