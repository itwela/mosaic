import { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import WorkspaceGrid from "./components/WorkspaceGrid";
import AboutView from "./components/AboutView";
import HelpView from "./components/HelpView";
import SettingsView from "./components/SettingsView";
import { Workspace } from "./types";
import { loadWorkspaces, saveWorkspaces } from "./store/workspaces";
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
