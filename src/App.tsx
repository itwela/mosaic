import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import JSZip from "jszip";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import WorkspaceGrid from "./components/WorkspaceGrid";
import AboutView from "./components/AboutView";
import HelpView from "./components/HelpView";
import SettingsView from "./components/SettingsView";
import CommandsView from "./components/CommandsView";
import AllRunningView from "./components/AllRunningView";
import FieldnotesView from "./components/FieldnotesView";
import UndoToast from "./components/UndoToast";
import { AgentStatus, Workspace } from "./types";
import { sessionToMeta, SessionStatus, TabMeta, AgentScreenState, TabSignals, ApprovalOffer } from "./lib/agents";
import { AttentionTarget } from "./lib/approvals";
import { useFieldnotesProgress } from "./lib/fieldnotesProgress";
import { createWorkspaceBundle, EmbeddedFile, loadWorkspaces, makeFieldnotesPanel, makeLauncherPanel, makePanel, makeUsagePanel, makeZenPanel, parseWorkspaceBundle, saveWorkspaces, setWorkspaceMutator } from "./store/workspaces";
import { insertAt, pushUndo } from "./store/undo";
import { recordCommand } from "./store/commands";
import "./App.css";
import "./luxury.css";
import "./themes/aero.css";
import "./workshop.css";

type View = "workspace" | "all" | "about" | "help" | "settings" | "commands" | "fieldnotes";

const STATUS_POLL_MS = 2000;

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(loadWorkspaces);
  const [activeId, setActiveId] = useState<string>(workspaces[0].id);
  const [view, setView] = useState<View>("workspace");
  // Mounted from the start so the dashboard can read real checklist progress
  // (including the empty state when the gitignored client files are absent).
  const notes = useFieldnotesProgress();
  const [tabMeta, setTabMeta] = useState<Record<string, TabMeta>>({});
  const screenshotToggleRef = useRef<() => void>(() => {});

  useEffect(() => {
    setWorkspaceMutator((fn) => setWorkspaces(fn));
    return () => setWorkspaceMutator(null);
  }, []);

  // Window bounds persistence + screenshot ("tuck") mode. The global shortcut
  // (Cmd/Ctrl+Shift+S, registered in Rust) and the same in-app key both toggle
  // a tiny bottom-right pill so the rest of the screen is free for screenshots.
  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let normalSize: LogicalSize | PhysicalSize = new LogicalSize(960, 640);
    let normalPosition: LogicalPosition | PhysicalPosition = new LogicalPosition(80, 80);
    let restoring = false;
    let screenshotMode = false;
    let screenshotNormal: { size: LogicalSize | PhysicalSize; position: LogicalPosition | PhysicalPosition } | null = null;
    let lastToggleAt = 0;
    let toggling = false;
    let disposed = false;
    const unlisten: Array<() => void> = [];

    try {
      const saved = JSON.parse(localStorage.getItem("mosaic-window-bounds") ?? "null");
      if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
        normalSize = new PhysicalSize(saved.width, saved.height);
        normalPosition = new PhysicalPosition(saved.x, saved.y);
      }
    } catch { /* use the safe default window size */ }

    const persistBounds = (size: PhysicalSize, position: PhysicalPosition) => {
      normalSize = size;
      normalPosition = position;
      localStorage.setItem("mosaic-window-bounds", JSON.stringify({
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
      }));
    };

    const rememberNormalBounds = async () => {
      if (restoring || screenshotMode) return;
      try {
        if (await appWindow.isMinimized() || await appWindow.isMaximized() || await appWindow.isFullscreen()) return;
        persistBounds(await appWindow.innerSize(), await appWindow.outerPosition());
      } catch { /* the window may be closing */ }
    };

    const restoreNormalBounds = async () => {
      try {
        const fullscreen = await appWindow.isFullscreen();
        const maximized = await appWindow.isMaximized();
        if (!fullscreen && !maximized) {
          await rememberNormalBounds();
          return;
        }

        restoring = true;
        if (fullscreen) await appWindow.setFullscreen(false);
        if (await appWindow.isMaximized()) await appWindow.unmaximize();
        await appWindow.setSize(normalSize);
        await appWindow.setPosition(normalPosition);
      } catch { /* let macOS finish restoring the window if its state changed */ }
      finally { restoring = false; }
    };

    const toggleScreenshotMode = async () => {
      const now = Date.now();
      if (toggling || now - lastToggleAt < 350) return; // debounce the key + global shortcut double-fire
      lastToggleAt = now;
      toggling = true;
      try {
        if (screenshotMode) {
          await appWindow.setAlwaysOnTop(false);
          await appWindow.setMinSize(new LogicalSize(800, 500));
          if (screenshotNormal) {
            await appWindow.setSize(screenshotNormal.size);
            await appWindow.setPosition(screenshotNormal.position);
          }
          screenshotNormal = null;
          screenshotMode = false;
        } else {
          const size = await appWindow.innerSize();
          const position = await appWindow.outerPosition();
          screenshotNormal = { size, position };
          const monitor = await currentMonitor() ?? await primaryMonitor();
          const w = 360;
          const h = 200;
          const mx = monitor?.position.x ?? 0;
          const my = monitor?.position.y ?? 0;
          const mw = monitor?.size.width ?? 0;
          const mh = monitor?.size.height ?? 0;
          const scale = monitor?.scaleFactor ?? 1;
          const x = mx + mw - (w + 16) * scale;
          const y = my + mh - (h + 48) * scale;
          screenshotMode = true;
          if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
          if (await appWindow.isMaximized()) await appWindow.unmaximize();
          await appWindow.setMinSize(new LogicalSize(w, h));
          await appWindow.setSize(new LogicalSize(w, h));
          await appWindow.setPosition(new PhysicalPosition(x, y));
          await appWindow.setAlwaysOnTop(true);
          screenshotMode = true;
        }
      } catch (error) {
        console.error("[mosaic] tuck failed", error);
        window.alert(`Could not toggle tuck: ${String(error)}`);
      } finally { toggling = false; }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        void toggleScreenshotMode();
      }
    };
    // Capture phase so it fires even when xterm's textarea has keyboard focus.
    window.addEventListener("keydown", onKeyDown, true);
    screenshotToggleRef.current = () => { void toggleScreenshotMode(); };

    void (async () => {
      const fullscreen = await appWindow.isFullscreen();
      const maximized = await appWindow.isMaximized();
      const minimized = await appWindow.isMinimized();
      if (!fullscreen && !maximized && !minimized) await rememberNormalBounds();

      if (disposed) return;
      unlisten.push(await appWindow.onResized(() => { void rememberNormalBounds(); }));
      unlisten.push(await appWindow.onMoved(() => { void rememberNormalBounds(); }));
      unlisten.push(await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) void restoreNormalBounds();
        else void rememberNormalBounds();
      }));
      unlisten.push(await listen("toggle-screenshot-mode", () => { void toggleScreenshotMode(); }));
      if (disposed) unlisten.splice(0).forEach((off) => off());
    })();

    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown, true);
      unlisten.splice(0).forEach((off) => off());
    };
  }, []);

  // Poll the Rust side for what each live terminal is running, so tabs and
  // workspaces can show a live agent status dot.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let sessions: SessionStatus[] = [];
    const screens: Record<string, AgentScreenState> = {};
    const approvals: Record<string, ApprovalOffer | null> = {};
    const signals: Record<string, TabSignals> = {};
    const update = () => {
      const map: Record<string, TabMeta> = {};
      for (const s of sessions) map[s.id] = sessionToMeta(s, screens[s.id], signals[s.id], approvals[s.id] ?? null);
      if (!disposed) setTabMeta(map);
    };
    const onNotify = (event: Event) => {
      const { id, state, at } = (event as CustomEvent<{ id: string; state: "attention" | "ready"; at: number }>).detail;
      signals[id] = { ...signals[id], notify: { state, at } };
      update();
    };
    const onInput = (event: Event) => {
      const { id, at } = (event as CustomEvent<{ id: string; at: number }>).detail;
      const cur = signals[id] ?? {};
      // The question still on screen is the one this keystroke answered.
      signals[id] = { ...cur, inputAt: at, dismissedPrompt: cur.screenPrompt ?? cur.dismissedPrompt };
      update();
    };
    window.addEventListener("mosaic-agent-notify", onNotify);
    window.addEventListener("mosaic-agent-input", onInput);
    const onScreen = (event: Event) => {
      const { id, state, approval } = (event as CustomEvent<{ id: string; state: AgentScreenState; approval: ApprovalOffer | null }>).detail;
      screens[id] = state;
      approvals[id] = approval;
      const cur = signals[id] ?? {};
      if (state === "attention") {
        const key = approval?.key || approval?.prompt || "attention";
        // Same dialog (including a re-wrap) keeps its dismissal. A different key
        // is a new question and can light the alarm again.
        if (cur.screenPrompt !== key) {
          signals[id] = {
            ...cur,
            screenPrompt: key,
            dismissedPrompt: cur.dismissedPrompt === key ? cur.dismissedPrompt : undefined,
          };
        }
      } else if (cur.screenPrompt || cur.dismissedPrompt) {
        // The prompt left the live window, including when it scrolled into history.
        signals[id] = { ...cur, screenPrompt: undefined, dismissedPrompt: undefined };
      }
      update();
    };
    window.addEventListener("mosaic-agent-screen", onScreen);
    const tick = async () => {
      try {
        const list = await invoke<SessionStatus[]>("pty_statuses");
        sessions = list;
        update();
      } catch { /* command not registered yet during first paint */ }
    };
    void tick();
    const interval = setInterval(tick, STATUS_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(interval);
      window.removeEventListener("mosaic-agent-screen", onScreen);
      window.removeEventListener("mosaic-agent-notify", onNotify);
      window.removeEventListener("mosaic-agent-input", onInput);
    };
  }, []);

  useEffect(() => {
    saveWorkspaces(workspaces);
  }, [workspaces]);

  // Backfill the global command database from commands already saved to tabs.
  useEffect(() => {
    const seen = new Set<string>();
    for (const ws of workspaces) {
      for (const panel of ws.panels) {
        for (const tab of panel.tabs) {
          for (const cmd of tab.savedCommands ?? []) {
            if (!seen.has(cmd.text)) {
              seen.add(cmd.text);
              recordCommand(cmd.text, cmd.label);
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workspaceStatus = useMemo(() => {
    const map: Record<string, AgentStatus> = {};
    for (const ws of workspaces) {
      let attention = false;
      let running = false;
      let terminal = false;
      for (const panel of ws.panels) {
        if (panel.type === "launcher") continue;
        for (const tab of panel.tabs) {
          const status = tabMeta[tab.id]?.status ?? "idle";
          if (status === "attention") attention = true;
          else if (status === "running") running = true;
          else if (status === "terminal") terminal = true;
        }
      }
      map[ws.id] = attention ? "attention" : running ? "running" : terminal ? "terminal" : "idle";
    }
    return map;
  }, [workspaces, tabMeta]);

  function updateWorkspace(updated: Workspace) {
    setWorkspaces((ws) => ws.map((w) => (w.id === updated.id ? updated : w)));
  }

  function addToActive(panel: Workspace["panels"][number]) {
    setWorkspaces((all) => all.map((w) => (w.id === activeId ? { ...w, panels: [...w.panels, panel] } : w)));
    setView("workspace");
  }

  function openAttention(target: AttentionTarget) {
    setView("workspace");
    setActiveId(target.workspaceId);
    setWorkspaces((all) => all.map((w) => w.id !== target.workspaceId ? w : {
      ...w,
      panels: w.panels.map((panel) => panel.id === target.panelId ? { ...panel, activeTabId: target.tabId } : panel),
    }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("mosaic-focus-tab", { detail: { id: target.tabId } }));
    }, 50);
  }

  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const titles: Record<View, string> = {
    workspace: activeWorkspace?.name ?? "Mosaic",
    all: "All running",
    commands: "Command database",
    fieldnotes: "Field notes",
    settings: "Settings",
    help: "What's this",
    about: "Caveman Creative",
  };

  function addWorkspace(ws: Workspace) {
    setWorkspaces((prev) => [...prev, ws]);
    setActiveId(ws.id);
  }

  function renameWorkspace(id: string, name: string) {
    setWorkspaces((ws) => ws.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  function deleteWorkspace(id: string) {
    const index = workspaces.findIndex((w) => w.id === id);
    const ws = workspaces[index];
    if (!ws) return;
    const remaining = workspaces.filter((w) => w.id !== id);
    setWorkspaces(remaining);
    if (activeId === id) setActiveId(remaining[0].id);
    // Its shells keep running until the undo window closes.
    pushUndo(
      `Deleted workspace "${ws.name}"`,
      () => {
        setWorkspaces((cur) => (cur.some((w) => w.id === ws.id) ? cur : insertAt(cur, index, ws)));
        setActiveId(ws.id);
        setView("workspace");
      },
      () => {
        for (const panel of ws.panels) {
          for (const tab of panel.tabs) invoke("pty_kill", { id: tab.id }).catch(console.error);
        }
      },
    );
  }

  function reorderWorkspaces(next: Workspace[]) {
    setWorkspaces(next);
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
      <div className="workshop-grade" aria-hidden="true">
        <div className="g-warm" />
        <div className="g-grain" />
        <div className="g-rgb" />
        <div className="g-vig" />
        <div className="g-scan" />
      </div>
      <Sidebar
        workspaces={workspaces}
        activeId={activeId}
        workspaceStatus={workspaceStatus}
        tabMeta={tabMeta}
        view={view}
        onSelect={(id) => { setActiveId(id); setView("workspace"); }}
        onAdd={addWorkspace}
        onRename={renameWorkspace}
        onDelete={deleteWorkspace}
        onReorder={reorderWorkspaces}
        onExport={exportWorkspace}
        onImport={importWorkspace}
        onAbout={() => toggleView("about")}
        onHelp={() => toggleView("help")}
        onSettings={() => toggleView("settings")}
        onCommands={() => toggleView("commands")}
        onFieldnotes={() => toggleView("fieldnotes")}
        onAllRunning={() => toggleView("all")}
      />
      <div className="stage">
      <TopBar
        title={titles[view]}
        onAddTerminal={() => addToActive(makePanel())}
        onAddLauncher={() => addToActive(makeLauncherPanel())}
        onAddUsage={() => addToActive(makeUsagePanel())}
        onAddFieldnotes={() => addToActive(makeFieldnotesPanel())}
        onAddZen={() => addToActive(makeZenPanel())}
        onTuck={() => screenshotToggleRef.current()}
      />
      <div className="stage-body">
      {view === "all" && (
        <AllRunningView
          workspaces={workspaces}
          tabMeta={tabMeta}
          onOpenWorkspace={(id) => { setActiveId(id); setView("workspace"); }}
        />
      )}
      {view === "about" && <AboutView />}
      {view === "help" && <HelpView />}
      {view === "settings" && <SettingsView />}
      {view === "commands" && <CommandsView />}
      <FieldnotesView visible={view === "fieldnotes"} />

      {/* Keep all workspace grids mounted so terminals never restart */}
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          style={{ display: view === "workspace" && ws.id === activeId ? "contents" : "none" }}
        >
          <WorkspaceGrid
            active={view === "workspace" && ws.id === activeId}
            workspace={ws}
            workspaces={workspaces}
            tabMeta={tabMeta}
            notes={notes}
            onUpdate={updateWorkspace}
            onOpenAttention={openAttention}
          />
        </div>
      ))}
      </div>
      </div>
      <UndoToast />
    </div>
  );
}
