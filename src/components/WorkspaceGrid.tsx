import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { Panel as PanelType, Workspace } from "../types";
import { TabMeta } from "../lib/agents";
import ScreenshotBar from "./ScreenshotBar";
import TerminalPanel from "./TerminalPanel";
import LauncherPanel from "./LauncherPanel";
import UsagePanel from "./UsagePanel";
import FieldnotesPanel from "./FieldnotesPanel";
import { makePanel, makeLauncherPanel, makeUsagePanel, makeFieldnotesPanel, restorePanel } from "../store/workspaces";
import { pushUndo } from "../store/undo";
import "./WorkspaceGrid.css";

interface Props {
  workspace: Workspace;
  active: boolean;
  tabMeta: Record<string, TabMeta>;
  onUpdate: (ws: Workspace) => void;
  onToggleScreenshot: () => void;
}

export default function WorkspaceGrid({ active, workspace, tabMeta, onUpdate, onToggleScreenshot }: Props) {
  const panels = workspace.panels;
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // Panels faded back so the mosaic shows through (double-click a panel's header).
  const [faded, setFaded] = useState<Set<string>>(new Set());

  function toggleFaded(e: React.MouseEvent, id: string) {
    const target = e.target as HTMLElement;
    if (!target.closest(".tab-bar, .launcher-header")) return;
    if (target.closest("button, input, select, .tab-item")) return;
    setFaded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const dragSourceRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  function updatePanel(updated: PanelType) {
    onUpdate({
      ...workspace,
      panels: panels.map((p) => (p.id === updated.id ? updated : p)),
    });
  }

  function addPanel() {
    onUpdate({ ...workspace, panels: [...panels, makePanel()] });
  }

  function addLauncher() {
    onUpdate({ ...workspace, panels: [...panels, makeLauncherPanel()] });
  }

  function addFieldnotes() {
    onUpdate({ ...workspace, panels: [...panels, makeFieldnotesPanel()] });
  }

  function addUsage() {
    onUpdate({ ...workspace, panels: [...panels, makeUsagePanel()] });
  }

  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".grid-menu-wrap")) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  function clearAll() {
    for (const panel of panels) {
      // Ctrl+L (form feed) instead of typing "clear\r": it clears the screen in
      // any folder without executing a command or mangling half-typed input.
      invoke("pty_write", { id: panel.activeTabId, data: "\x0c" }).catch(console.error);
    }
  }

  function removePanel(id: string) {
    if (panels.length <= 1) return;
    const index = panels.findIndex((p) => p.id === id);
    const panel = panels[index];
    if (!panel) return;
    onUpdate({ ...workspace, panels: panels.filter((p) => p.id !== id) });
    // Shells keep running until the undo window closes, so Undo brings them back live.
    pushUndo(
      `Closed ${panel.type === "launcher" ? `launcher "${panel.name || "Launcher"}"` : panel.type === "usage" ? "usage panel" : panel.type === "fieldnotes" ? "field notes panel" : "terminal panel"}`,
      () => restorePanel(workspace.id, index, panel),
      () => {
        for (const tab of panel.tabs) invoke("pty_kill", { id: tab.id }).catch(console.error);
      },
    );
  }

  // Drop panel A onto panel B -> they swap positions. Predictable in a grid.
  function swapPanels(from: number, to: number) {
    const next = [...panels];
    [next[from], next[to]] = [next[to], next[from]];
    onUpdate({ ...workspace, panels: next });
  }

  function startReorder(index: number, x: number, y: number) {
    dragSourceRef.current = index;
    dragOverRef.current = index;
    setDragSource(index);
    setDragOver(index);
    setDragPos({ x, y });
  }

  // Pointer-based drag with a floating ghost (HTML5 drag is unreliable in Tauri).
  useEffect(() => {
    if (dragSource === null) return;

    function onMove(e: PointerEvent) {
      setDragPos({ x: e.clientX, y: e.clientY });
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const container = el?.closest("[data-panel-index]") as HTMLElement | null;
      const idx = container ? Number(container.dataset.panelIndex) : null;
      if (idx !== dragOverRef.current) {
        dragOverRef.current = idx;
        setDragOver(idx);
      }
    }

    function onUp() {
      const src = dragSourceRef.current;
      const dst = dragOverRef.current;
      if (src !== null && dst !== null && dst !== src) {
        swapPanels(src, dst);
      }
      dragSourceRef.current = null;
      dragOverRef.current = null;
      setDragSource(null);
      setDragOver(null);
      setDragPos(null);
    }

    function preventSelect(e: Event) {
      e.preventDefault();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("selectstart", preventSelect);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("selectstart", preventSelect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSource]);

  function panelLabel(panel: PanelType): string {
    if (panel.type === "launcher") return panel.name || "Launcher";
    if (panel.type === "usage") return "Usage";
    if (panel.type === "fieldnotes") return "Field notes";
    const active = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];
    return active?.title || "Terminal";
  }

  const COLS = Math.ceil(Math.sqrt(panels.length));
  const rows: PanelType[][] = [];
  for (let i = 0; i < panels.length; i += COLS) {
    rows.push(panels.slice(i, i + COLS));
  }

  return (
    <div className="workspace-grid-wrapper">
      <div className="grid-toolbar">
        <span className="grid-workspace-name">{workspace.name}</span>
        <ScreenshotBar active={active} />
        <div className="grid-toolbar-actions">
          <button className="grid-clear-all" onClick={clearAll} title="Clear all terminals">
            clear all
          </button>
          <button className="grid-add-panel" onClick={addPanel} title="Add terminal panel">
            + terminal
          </button>
          <div className="grid-menu-wrap">
            <button className={`grid-add-launcher ${menuOpen ? "grid-menu-open" : ""}`} onClick={() => setMenuOpen((o) => !o)} title="Add a window">
              + window ▾
            </button>
            {menuOpen && (
              <div className="grid-menu">
                <button onClick={() => { setMenuOpen(false); addPanel(); }}>Terminal</button>
                <button onClick={() => { setMenuOpen(false); addLauncher(); }}>Launcher board</button>
                <button onClick={() => { setMenuOpen(false); addUsage(); }}>AI usage</button>
                <button onClick={() => { setMenuOpen(false); addFieldnotes(); }}>Field notes</button>
              </div>
            )}
          </div>
          <button className="grid-tuck-btn" onClick={onToggleScreenshot} title="Tuck to corner (⌘⇧S)">
            ⤢ tuck
          </button>
        </div>
      </div>

      <div className="grid-body">
        <Group orientation="vertical" className="panel-group-v">
          {rows.map((row, ri) => (
            <Fragment key={`row-${ri}`}>
              {ri > 0 && <Separator className="resize-handle-h" />}
              <Panel minSize={10}>
                <Group orientation="horizontal" className="panel-group-h">
                  {row.map((panel, ci) => {
                    const flatIndex = ri * COLS + ci;
                    const isDragging = dragSource === flatIndex;
                    const isTarget = dragSource !== null && dragSource !== flatIndex && dragOver === flatIndex;
                    return (
                      <Fragment key={panel.id}>
                        {ci > 0 && <Separator className="resize-handle-v" />}
                        <Panel minSize={10}>
                          <div
                            className={`panel-container ${isDragging ? "panel-dragging" : ""} ${isTarget ? "panel-drop-target" : ""} ${faded.has(panel.id) ? "panel-faded" : ""}`}
                            onDoubleClick={(e) => toggleFaded(e, panel.id)}
                            data-panel-index={flatIndex}
                          >
                            <div className="window-frame">
                              {panel.type === "fieldnotes"
                                ? <FieldnotesPanel viewId={panel.viewId ?? panel.id} panelIndex={flatIndex} active={active} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
                                : panel.type === "usage"
                                ? <UsagePanel panelIndex={flatIndex} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
                                : panel.type === "launcher"
                                ? <LauncherPanel panel={panel} panelIndex={flatIndex} onReorderStart={startReorder} onUpdate={updatePanel} onClosePanel={() => removePanel(panel.id)} />
                                : <TerminalPanel panel={panel} panelIndex={flatIndex} onReorderStart={startReorder} tabMeta={tabMeta} onUpdate={updatePanel} onClosePanel={() => removePanel(panel.id)} />
                              }
                            </div>
                          </div>
                        </Panel>
                      </Fragment>
                    );
                  })}
                </Group>
              </Panel>
            </Fragment>
          ))}
        </Group>
      </div>

      {dragSource !== null && dragPos && createPortal(
        <div className="panel-drag-ghost" style={{ left: dragPos.x, top: dragPos.y }}>
          <span className="grip-dots">⠿</span>
          <span className="panel-drag-ghost-label">{panelLabel(panels[dragSource])}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
