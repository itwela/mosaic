import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import JSZip from "jszip";
import Sidebar from "./components/Sidebar";
import WorkspaceGrid from "./components/WorkspaceGrid";
import AboutView from "./components/AboutView";
import HelpView from "./components/HelpView";
import SettingsView from "./components/SettingsView";
import { Workspace } from "./types";
import { createWorkspaceBundle, EmbeddedFile, loadWorkspaces, parseWorkspaceBundle, saveWorkspaces } from "./store/workspaces";
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

  async function exportWorkspace(ws: Workspace) {
    const paths = [...new Set(ws.panels.flatMap((panel) =>
      (panel.launchItems ?? []).filter((item) => item.kind !== "url").map((item) => item.path)
    ))];
    const embeddedFiles: EmbeddedFile[] = [];
    for (const path of paths) {
      try {
        const result = await invoke<{ name: string; data: string } | null>("read_file_for_export", { path });
        if (result) embeddedFiles.push({ originalPath: path, ...result });
      } catch { /* inaccessible apps/directories stay path-based */ }
    }
    const zip = new JSZip();
    zip.file("workspace.json", JSON.stringify(createWorkspaceBundle(ws, embeddedFiles), null, 2));
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ws.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "mosaic-workspace"}.mosaic.zip`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importWorkspace(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        let raw: any;
        if (file.name.toLowerCase().endsWith(".zip")) {
          const zip = await JSZip.loadAsync(reader.result as ArrayBuffer);
          const workspaceFile = zip.file("workspace.json");
          if (!workspaceFile) throw new Error("This archive does not contain a Mosaic workspace.");
          raw = JSON.parse(await workspaceFile.async("string"));
        } else {
          raw = JSON.parse(String(reader.result));
        }
        const imported = parseWorkspaceBundle(raw);
        const embeddedFiles = Array.isArray(raw.embeddedFiles) ? raw.embeddedFiles : [];
        if (embeddedFiles.length) {
          const restored = await Promise.all(embeddedFiles.map(async (file: EmbeddedFile) => {
            const path = await invoke<string>("restore_exported_file", { workspaceName: imported.name, name: file.name, data: file.data });
            return [file.originalPath, path] as const;
          }));
          const pathMap = new Map<string, string>(restored);
          imported.panels = imported.panels.map((panel) => ({
            ...panel,
            launchItems: panel.launchItems?.map((item) => ({ ...item, path: pathMap.get(item.path) ?? item.path })),
          }));
        }
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
    if (file.name.toLowerCase().endsWith(".zip")) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
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
