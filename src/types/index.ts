export interface Tab {
  id: string;
  title: string;
  cwd?: string;
}

export interface LaunchItem {
  id: string;
  name: string;
  path: string;
  kind?: "file" | "url";
}

export interface Panel {
  id: string;
  type?: "terminal" | "launcher";
  // terminal
  tabs: Tab[];
  activeTabId: string;
  // launcher
  launchItems?: LaunchItem[];
}

export interface Workspace {
  id: string;
  name: string;
  panels: Panel[];
  layout: number[]; // panel size percentages for resizable-panels
}
