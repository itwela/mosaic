import PanelMount from "./PanelMount";
import PaneSize from "./PaneSize";
import Icon from "./Icon";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { Panel as PanelType, Workspace } from "../types";
import { TabMeta } from "../lib/agents";
import ScreenshotBar from "./ScreenshotBar";
import { useNarrow } from "../lib/useNarrow";
import TerminalPanel from "./TerminalPanel";
import LauncherPanel from "./LauncherPanel";
import ZenPanel from "./ZenPanel";
import UsagePanel from "./UsagePanel";
import FieldnotesPanel from "./FieldnotesPanel";
import { makePanel, makeLauncherPanel, makeUsagePanel, makeFieldnotesPanel, makeZenPanel, restorePanel, movePanelToWorkspace } from "../store/workspaces";
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
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(window.innerWidth);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setGridWidth(Math.round(entry.contentRect.width));
    });
    if (gridRef.current) observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, []);
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
  // Sidebar workspace currently under the dragged panel (drop = move it there).
  const dropWsRef = useRef<HTMLElement | null>(null);
  const [dropWsName, setDropWsName] = useState<string | null>(null);

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

  function addZen() {
    onUpdate({ ...workspace, panels: [...panels, makeZenPanel()] });
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
    const index = panels.findIndex((p) => p.id === id);
    const panel = panels[index];
    if (!panel) return;
    onUpdate({ ...workspace, panels: panels.filter((p) => p.id !== id) });
    // Shells keep running until the undo window closes, so Undo brings them back live.
    pushUndo(
      `Closed ${panel.type === "launcher" ? `launcher "${panel.name || "Launcher"}"` : panel.type === "usage" ? "usage panel" : panel.type === "fieldnotes" ? "field notes panel" : panel.type === "zen" ? "Zen Studio panel" : "terminal panel"}`,
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
      const wsEl = el?.closest("[data-workspace-id]") as HTMLElement | null;
      const wsTarget = wsEl && wsEl.dataset.workspaceId !== workspace.id ? wsEl : null;
      if (wsTarget !== dropWsRef.current) {
        dropWsRef.current?.classList.remove("workspace-panel-drop");
        wsTarget?.classList.add("workspace-panel-drop");
        dropWsRef.current = wsTarget;
        setDropWsName(wsTarget ? wsTarget.querySelector(".workspace-name")?.textContent ?? "workspace" : null);
      }
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
      const wsTarget = dropWsRef.current;
      if (src !== null && wsTarget?.dataset.workspaceId) {
        movePanelToWorkspace(panels[src].id, wsTarget.dataset.workspaceId);
      } else if (src !== null && dst !== null && dst !== src) {
        swapPanels(src, dst);
      }
      wsTarget?.classList.remove("workspace-panel-drop");
      dropWsRef.current = null;
      setDropWsName(null);
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
    if (panel.type === "zen") return "Zen Studio";
    const active = panel.tabs.find((t) => t.id === panel.activeTabId) ?? panel.tabs[0];
    return active?.title || "Terminal";
  }

  // A pane carries the most urgent status among its tabs; the glass behind it lights to match.
  function paneStatus(panel: PanelType): string {
    if (panel.type && panel.type !== "terminal") return "none";
    const st = panel.tabs.map((t) => tabMeta[t.id]?.status ?? "idle");
    return st.includes("attention") ? "attention" : st.includes("running") ? "running" : st.includes("ready") ? "ready" : st.includes("terminal") ? "terminal" : "idle";
  }
  const allStatus = panels.map(paneStatus);
  const working = allStatus.filter((s) => s === "running").length;
  const waiting = allStatus.filter((s) => s === "attention").length;

  const narrow = useNarrow();
  const COLS = narrow ? 1 : Math.max(1, Math.min(Math.ceil(Math.sqrt(panels.length)), Math.floor((gridWidth - 24) / 280)));
  const rows: PanelType[][] = [];
  for (let i = 0; i < panels.length; i += COLS) {
    rows.push(panels.slice(i, i + COLS));
  }

  const contentNodes = useRef(new Map<string, HTMLDivElement>());
  function contentFor(id: string) {
    let node = contentNodes.current.get(id);
    if (!node) { node = document.createElement("div"); node.className = "pane-content"; contentNodes.current.set(id, node); }
    node.ondblclick = e => toggleFaded(e as unknown as React.MouseEvent, id);
    return node;
  }
  useEffect(() => {
    const ids = new Set(panels.map(p => p.id));
    for (const id of contentNodes.current.keys()) if (!ids.has(id)) contentNodes.current.delete(id);
  }, [panels]);
  function renderContent(panel: PanelType, flatIndex: number) {
    return (panel.type === "fieldnotes"
            ? <FieldnotesPanel viewId={panel.viewId ?? panel.id} panelIndex={flatIndex} active={active} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
            : panel.type === "zen"
            ? <ZenPanel panelIndex={flatIndex} active={active} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
            : panel.type === "usage"
            ? <UsagePanel panelIndex={flatIndex} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
            : panel.type === "launcher"
            ? <LauncherPanel panel={panel} panelIndex={flatIndex} onReorderStart={startReorder} onUpdate={updatePanel} onClosePanel={() => removePanel(panel.id)} />
            : <TerminalPanel panel={panel} panelIndex={flatIndex} onReorderStart={startReorder} tabMeta={tabMeta} onUpdate={updatePanel} onClosePanel={() => removePanel(panel.id)} />
          );
  }

  function renderPanel(panel: PanelType, flatIndex: number) {
    const isDragging = dragSource === flatIndex;
    const isTarget = dragSource !== null && dragSource !== flatIndex && dragOver === flatIndex;
    return (
      <div
        className={`panel-container ${isDragging ? "panel-dragging" : ""} ${isTarget ? "panel-drop-target" : ""} ${faded.has(panel.id) ? "panel-faded" : ""}`}
        onDoubleClick={(e) => toggleFaded(e, panel.id)}
        data-panel-index={flatIndex}
        data-glass-status={active ? allStatus[flatIndex] : undefined}
        data-pane-status={allStatus[flatIndex]}
        data-pane-type={panel.type ?? "terminal"}
      >
        <PanelMount content={contentFor(panel.id)} />
      </div>
    );
  }

  return (
    <div ref={gridRef} className="workspace-grid-wrapper" onPointerDownCapture={e => {
      if (!(e.target as HTMLElement).closest('[role="separator"], .resize-handle-h, .resize-handle-v, .panel-drag-grip')) return;
      window.getSelection()?.removeAllRanges();
      document.documentElement.classList.add("pane-resizing");
      const end = () => { document.documentElement.classList.remove("pane-resizing"); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
      window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    }}>
      <div className="grid-toolbar" data-tauri-drag-region>
        <span className="grid-workspace-name" data-glass-light={active ? "none 0.45 150" : undefined}>{workspace.name}</span>
        <span className="grid-summary">
          <span>{panels.length === 0 ? "no panes yet" : `${panels.length} ${panels.length === 1 ? "pane" : "panes"}`}</span>
          {working > 0 && <span className="grid-summary-working">{working}<i> working</i></span>}
          {waiting > 0 && <span className="grid-summary-waiting">{waiting}<i> {waiting === 1 ? "needs you" : "need you"}</i></span>}
        </span>
        <ScreenshotBar active={active} />
        <div className="grid-toolbar-actions">
          <button className="grid-clear-all" onClick={clearAll} title="Clear all terminals">
            clear all
          </button>
          <button className="grid-add-panel" onClick={addPanel} title="Add terminal panel">
            <Icon name="plus" /><span>terminal</span>
          </button>
          <div className="grid-menu-wrap">
            <button className={`grid-add-launcher ${menuOpen ? "grid-menu-open" : ""}`} onClick={() => setMenuOpen((o) => !o)} title="Add a window">
              <Icon name="more" className="compact-only" /><Icon name="plus" /><span>window</span><Icon name="chev" />
            </button>
            {menuOpen && (
              <div className="grid-menu">
                <button onClick={() => { setMenuOpen(false); addPanel(); }}>Terminal</button>
                <button onClick={() => { setMenuOpen(false); addLauncher(); }}>Launcher board</button>
                <button onClick={() => { setMenuOpen(false); addUsage(); }}>AI usage</button>
                <button onClick={() => { setMenuOpen(false); addFieldnotes(); }}>Field notes</button>
                <button onClick={() => { setMenuOpen(false); addZen(); }}>Zen Studio</button>
                {panels.length === 1 && <>
                  <button onClick={() => { setMenuOpen(false); const r = contentFor(panels[0].id).getBoundingClientRect(); onUpdate({ ...workspace, soloLayout: { width: Math.min(900, r.width * .85), height: Math.min(650, r.height * .85), centered: true } }); }}>Center pane</button>
                  <button onClick={() => { setMenuOpen(false); onUpdate({ ...workspace, soloLayout: undefined }); }}>Fit pane to workspace</button>
                </>}
                <button className="compact-only" onClick={() => { setMenuOpen(false); clearAll(); }}>Clear all terminals</button>
                <button className="compact-only" onClick={() => { setMenuOpen(false); onToggleScreenshot(); }}>Tuck to corner</button>
              </div>
            )}
          </div>
          <button className="grid-tuck-btn" onClick={onToggleScreenshot} title="Tuck to corner (⌘⇧S)">
            <Icon name="tuck" />tuck
          </button>
        </div>
      </div>

      {panels.length === 0 ? (
        <div className="grid-empty" data-glass-dim={active ? "0.66" : undefined}>
          <img className="grid-empty-art" src="/textures/glass-art/empty.png" alt="" draggable={false} />
          <h2 className="grid-empty-title">Nothing is set in this window yet</h2>
          <p className="grid-empty-sub">Add a terminal or a board. Each one becomes a pane of glass you can resize and move.</p>
          <div className="grid-empty-tiles">
            {([
              ["Terminal", "box", "A real shell, with tabs", "opal", addPanel],
              ["Launcher board", "grid", "Files, apps and links", "amber", addLauncher],
              ["AI usage", "refresh", "Limits for every agent", "cobalt", addUsage],
              ["Field notes", "notes", "Client checklists", "ruby", addFieldnotes],
              ["Zen Studio", "zen", "The running studio", "violet", addZen],
            ] as const).map(([label, icon, sub, glass, add], i) => (
              <button
                key={label}
                className="grid-empty-tile"
                data-glass={glass}
                data-glass-light={active && i > 0 ? `${glass} 0.45 22` : undefined}
                autoFocus={i === 0}
                onClick={add}
              >
                <span className="grid-empty-chip"><Icon name={icon} /></span>
                <span className="grid-empty-label">{label}</span>
                <span className="grid-empty-desc">{sub}</span>
              </button>
            ))}
          </div>
          <p className="grid-empty-hint">Or drop a .mosaic.json file here to import a workspace</p>
        </div>
      ) : narrow ? (
        // compact window: one column of panes at their own heights, scrolling
        <div className="grid-body grid-body-stack">
          {panels.map((panel, i) => <PaneSize key={panel.id} compact centered={false} initial={{ width: 390, height: panel.compactHeight ?? (panel.type === "usage" ? 480 : panel.type === "fieldnotes" ? 420 : 300), centered: false }} onSave={size => updatePanel({ ...panel, compactHeight: size.height })}>{renderPanel(panel, i)}</PaneSize>)}
        </div>
      ) : panels.length === 1 ? (
        <div className="grid-body solo-stage">
          <PaneSize key={workspace.soloLayout ? "sized" : "fit"} initial={workspace.soloLayout} centered={workspace.soloLayout?.centered ?? false} onSave={soloLayout => onUpdate({ ...workspace, soloLayout })}>{renderPanel(panels[0], 0)}</PaneSize>
        </div>
      ) : (
      <div className="grid-body">
        <Group style={{ minHeight: rows.length * 180 + Math.max(0, rows.length - 1) * 6 }} resizeTargetMinimumSize={{ coarse: 44, fine: 14 }} orientation="vertical" className="panel-group-v">
          {rows.map((row, ri) => (
            <Fragment key={`row-${ri}`}>
              {ri > 0 && <Separator className="resize-handle-h" />}
              <Panel minSize="180px">
                <Group resizeTargetMinimumSize={{ coarse: 44, fine: 14 }} orientation="horizontal" className="panel-group-h">
                  {row.map((panel, ci) => {
                    const flatIndex = ri * COLS + ci;
                    return (
                      <Fragment key={panel.id}>
                        {ci > 0 && <Separator className="resize-handle-v" />}
                        <Panel minSize="240px">
                          {renderPanel(panel, flatIndex)}
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
      )}

      {panels.map((panel, i) => createPortal(renderContent(panel, i), contentFor(panel.id), panel.id))}
      {dragSource !== null && dragPos && createPortal(
        <div className="panel-drag-ghost" style={{ left: dragPos.x, top: dragPos.y }}>
          <Icon name="grip" className="grip-dots" />
          <span className="panel-drag-ghost-label">{panelLabel(panels[dragSource])}{dropWsName ? ` → ${dropWsName}` : ""}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
