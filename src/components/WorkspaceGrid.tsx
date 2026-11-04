import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { Panel as PanelType, Workspace } from "../types";
import { TabMeta } from "../lib/agents";
import { AttentionTarget } from "../lib/approvals";
import { FieldnotesProgress } from "../lib/fieldnotesProgress";
import TerminalPanel from "./TerminalPanel";
import LauncherPanel from "./LauncherPanel";
import ZenPanel from "./ZenPanel";
import UsagePanel from "./UsagePanel";
import FieldnotesPanel from "./FieldnotesPanel";
import WorkspaceDashboard from "./WorkspaceDashboard";
import { restorePanel, movePanelToWorkspace } from "../store/workspaces";
import { pushUndo } from "../store/undo";
import "./WorkspaceGrid.css";

interface Props {
  workspace: Workspace;
  workspaces: Workspace[];
  active: boolean;
  tabMeta: Record<string, TabMeta>;
  notes: FieldnotesProgress;
  onUpdate: (ws: Workspace) => void;
  onOpenAttention: (target: AttentionTarget) => void;
}

export default function WorkspaceGrid({ active, workspace, workspaces, tabMeta, notes, onUpdate, onOpenAttention }: Props) {
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
  // Sidebar workspace currently under the dragged panel (drop = move it there).
  const dropWsRef = useRef<HTMLElement | null>(null);
  const [dropWsName, setDropWsName] = useState<string | null>(null);

  function updatePanel(updated: PanelType) {
    onUpdate({
      ...workspace,
      panels: panels.map((p) => (p.id === updated.id ? updated : p)),
    });
  }

  function removePanel(id: string) {
    if (panels.length <= 1) return;
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

  // With a usage panel, keep a 3-column board so that panel can take the two
  // columns the guide gives AI usage. Other counts stay on the square grid.
  const COLS = panels.some((panel) => panel.type === "usage") && panels.length >= 4
    ? 3
    : Math.ceil(Math.sqrt(Math.max(panels.length, 1)));
  const rows: PanelType[][] = [];
  for (let i = 0; i < panels.length; i += COLS) {
    rows.push(panels.slice(i, i + COLS));
  }

  return (
    <div className="workspace-grid-wrapper">
      {active && (
        <WorkspaceDashboard
          workspace={workspace}
          workspaces={workspaces}
          tabMeta={tabMeta}
          notes={notes}
          onOpen={onOpenAttention}
        />
      )}
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
                    const attention = (!panel.type || panel.type === "terminal") && panel.tabs.some((tab) => tabMeta[tab.id]?.status === "attention");
                    const working = (!panel.type || panel.type === "terminal") && panel.tabs.some((tab) => tabMeta[tab.id]?.status === "running");
                    const spanRow = row.some((item) => item.type === "usage") && row.length > 1 && row.length < COLS;
                    const usageShare = spanRow ? Math.round((100 * (COLS - row.length + 1)) / COLS) : 0;
                    const otherShare = spanRow ? Math.round((100 - usageShare) / (row.length - 1)) : 0;
                    return (
                      <Fragment key={panel.id}>
                        {ci > 0 && <Separator className="resize-handle-v" />}
                        <Panel minSize={panel.type === "usage" && spanRow ? 40 : 10} defaultSize={spanRow ? `${panel.type === "usage" ? usageShare : otherShare}%` : undefined}>
                          <div
                            className={`panel-container ${isDragging ? "panel-dragging" : ""} ${isTarget ? "panel-drop-target" : ""} ${faded.has(panel.id) ? "panel-faded" : ""} ${attention ? "panel-wait" : working ? "panel-working" : ""}`}
                            onDoubleClick={(e) => toggleFaded(e, panel.id)}
                            data-panel-index={flatIndex}
                          >
                            <div className="window-frame">
                              <i className="brk tl" /><i className="brk tr" /><i className="brk bl" /><i className="brk br" />
                              {panel.type === "fieldnotes"
                                ? <FieldnotesPanel viewId={panel.viewId ?? panel.id} panelIndex={flatIndex} active={active} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
                                : panel.type === "zen"
                                ? <ZenPanel panelIndex={flatIndex} onReorderStart={startReorder} onClosePanel={() => removePanel(panel.id)} />
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
          <span className="panel-drag-ghost-label">{panelLabel(panels[dragSource])}{dropWsName ? ` → ${dropWsName}` : ""}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
