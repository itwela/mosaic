import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WorkspaceGrid from "./components/WorkspaceGrid";
import AboutView from "./components/AboutView";
import HelpView from "./components/HelpView";
import SettingsView from "./components/SettingsView";
import { Workspace } from "./types";
import { createWorkspaceBundle, loadWorkspaces, parseWorkspaceBundle, saveWorkspaces } from "./store/workspaces";
import "./App.css";

type View = "workspace" | "about" | "help" | "settings";

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(loadWorkspaces);
  const [activeId, setActiveId] = useState<string>(workspaces[0].id);
  const [view, setView] = useState<View>("workspace");

  useEffect(() => {
    saveWorkspaces(workspaces);
  }, [workspaces]);

  function updateWorkspace(updated: Workspace) {
    setWorkspaces((ws) => ws.map((w) => (w.id === updated.id ? updated : w)));
  }

  function addWorkspace(ws: Workspace) {
    setWorkspaces((prev) => [...prev, ws]);
    setActiveId(ws.id);
  }

  function renameWorkspace(id: string, name: string) {
    setWorkspaces((ws) => ws.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  function deleteWorkspace(id: string) {
    const remaining = workspaces.filter((w) => w.id !== id);
    setWorkspaces(remaining);
    if (activeId === id) setActiveId(remaining[0].id);
  }

  function exportWorkspace(ws: Workspace) {
    const blob = new Blob([JSON.stringify(createWorkspaceBundle(ws), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ws.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mosaic-workspace"}.mosaic.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importWorkspace(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = parseWorkspaceBundle(JSON.parse(String(reader.result)));
        const duplicateCount = workspaces.filter((ws) => ws.name === imported.name).length;
        const workspace = duplicateCount ? { ...imported, name: `${imported.name} (${duplicateCount + 1})` } : imported;
        setWorkspaces((prev) => [...prev, workspace]);
        setActiveId(workspace.id);
        setView("workspace");
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not import that workspace.");
      }
    };
    reader.onerror = () => window.alert("Could not read that workspace file.");
    reader.readAsText(file);
  }

  function toggleView(v: View) {
    setView((cur) => (cur === v ? "workspace" : v));
  }

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setView("workspace"); }}
        onAdd={addWorkspace}
        onRename={renameWorkspace}
        onDelete={deleteWorkspace}
        onExport={exportWorkspace}
        onImport={importWorkspace}
        onAbout={() => toggleView("about")}
        onHelp={() => toggleView("help")}
        onSettings={() => toggleView("settings")}
      />
      {view === "about" && <AboutView />}
      {view === "help" && <HelpView />}
      {view === "settings" && <SettingsView />}

      {/* Keep all workspace grids mounted so terminals never restart */}
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          style={{ display: view === "workspace" && ws.id === activeId ? "contents" : "none" }}
        >
          <WorkspaceGrid
            workspace={ws}
            onUpdate={updateWorkspace}
          />
        </div>
      ))}
    </div>
  );
}
