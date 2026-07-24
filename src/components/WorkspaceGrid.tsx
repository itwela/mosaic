import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { Panel as PanelType, Workspace } from "../types";
import TerminalPanel from "./TerminalPanel";
import LauncherPanel from "./LauncherPanel";
import { makePanel, makeLauncherPanel } from "../store/workspaces";
import "./WorkspaceGrid.css";

interface Props {
  workspace: Workspace;
  onUpdate: (ws: Workspace) => void;
}

export default function WorkspaceGrid({ workspace, onUpdate }: Props) {
  const panels = workspace.panels;

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

  function clearAll() {
    for (const panel of panels) {
      // Ctrl+L (form feed) instead of typing "clear\r": it clears the screen in
      // any folder without executing a command or mangling half-typed input.
      invoke("pty_write", { id: panel.activeTabId, data: "\x0c" }).catch(console.error);
    }
  }

  function removePanel(id: string) {
    if (panels.length <= 1) return;
    onUpdate({ ...workspace, panels: panels.filter((p) => p.id !== id) });
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
        <div className="grid-toolbar-actions">
          <button className="grid-clear-all" onClick={clearAll} title="Clear all terminals">
            clear all
          </button>
          <button className="grid-add-panel" onClick={addPanel} title="Add terminal panel">
            + terminal
          </button>
          <button className="grid-add-launcher" onClick={addLauncher} title="Add launcher board">
            + launcher
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
                  {row.map((panel, ci) => (
                    <Fragment key={panel.id}>
                      {ci > 0 && <Separator className="resize-handle-v" />}
                      <Panel minSize={10}>
                        <div className="panel-container">
                          <button
                            className="panel-close-btn"
                            title="Close panel"
                            onClick={() => removePanel(panel.id)}
                          >
                            ×
                          </button>
                          {panel.type === "launcher"
                            ? <LauncherPanel panel={panel} onUpdate={updatePanel} />
                            : <TerminalPanel panel={panel} onUpdate={updatePanel} />
                          }
                        </div>
                      </Panel>
                    </Fragment>
                  ))}
                </Group>
              </Panel>
            </Fragment>
          ))}
        </Group>
      </div>
    </div>
  );
}
