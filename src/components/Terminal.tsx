import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@xterm/xterm/css/xterm.css";

interface Props {
  id: string;
  active: boolean;
  cwd?: string;
}

export interface TerminalHandle {
  clear: () => void;
}

const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ id, active, cwd }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const prevCwdRef = useRef<string | undefined>(cwd);
  const dragOverRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);

  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear(),
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0e0a07",
        foreground: "#F6F0E6",
        cursor: "#c97d3a",
        selectionBackground: "#c97d3a40",
        black: "#1e1410",
        brightBlack: "#4a3523",
        red: "#c94a3a",
        brightRed: "#e05a48",
        green: "#8aab6a",
        brightGreen: "#9dbf7a",
        yellow: "#c97d3a",
        brightYellow: "#dfa050",
        blue: "#7a9cbf",
        brightBlue: "#90b4d8",
        magenta: "#b07a8a",
        brightMagenta: "#c88a9a",
        cyan: "#7aab9c",
        brightCyan: "#8ac0b0",
        white: "#F6F0E6",
        brightWhite: "#ffffff",
      },
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    mountedRef.current = true;
    prevCwdRef.current = cwd;

    const { cols, rows } = term;
    invoke("pty_create", { id, cols, rows, cwd: cwd ?? null }).catch(console.error);

    term.onData((data) => {
      invoke("pty_write", { id, data }).catch(console.error);
    });

    let unlisten1: (() => void) | null = null;
    let unlisten2: (() => void) | null = null;
    let unlisten3: (() => void) | null = null;

    listen<string>(`pty-data-${id}`, (event) => {
      term.write(event.payload);
    }).then((fn) => { unlisten1 = fn; });

    listen(`pty-exit-${id}`, () => {
      term.write("\r\n\x1b[31m[process exited]\x1b[0m\r\n");
    }).then((fn) => { unlisten2 = fn; });

    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && dragOverRef.current) {
        const paths: string[] = (event.payload as { type: string; paths: string[] }).paths;
        const text = paths.map((p) => p.includes(" ") ? `"${p}"` : p).join(" ");
        invoke("pty_write", { id, data: text }).catch(console.error);
        dragOverRef.current = false;
        setIsDragOver(false);
      }
      if (event.payload.type === "leave") {
        dragOverRef.current = false;
        setIsDragOver(false);
      }
    }).then((fn) => { unlisten3 = fn; });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      // Coalesce to one fit per animation frame instead of one per resize
      // tick. A live panel drag can fire this dozens of times a second;
      // calling fit() that often forces xterm to re-measure and reflow its
      // whole buffer on every intermediate frame, which is what produces
      // the stutter/garbled-text feeling during a drag.
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        fit.fit();
      });

      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        invoke("pty_resize", { id, cols: term.cols, rows: term.rows })
          .then(() => {
            // The shell only learns the new size once pty_resize lands, so
            // anything it drew mid-drag was sized for stale dimensions.
            // Force one clean full repaint now that cols/rows have settled.
            term.refresh(0, term.rows - 1);
          })
          .catch(console.error);
      }, 50);
    });
    ro.observe(containerRef.current);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      ro.disconnect();
      unlisten1?.();
      unlisten2?.();
      unlisten3?.();
      mountedRef.current = false;
      invoke("pty_kill", { id }).catch(console.error);
      term.dispose();
    };
  }, [id]);

  // when the saved folder changes on an already-running terminal, cd into it
  useEffect(() => {
    if (!mountedRef.current) return;
    if (cwd && cwd !== prevCwdRef.current) {
      prevCwdRef.current = cwd;
      const escaped = cwd.replace(/'/g, "'\\''");
      invoke("pty_write", { id, data: `cd '${escaped}'\r` }).catch(console.error);
    }
  }, [cwd, id]);

  useEffect(() => {
    if (active && fitRef.current && termRef.current) {
      const term = termRef.current;
      fitRef.current.fit();
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows })
        .then(() => {
          // This tab was display:none while inactive, so any output it
          // received was painted for whatever size it last knew about.
          // Force a clean repaint now that it's visible and re-sized.
          term.refresh(0, term.rows - 1);
        })
        .catch(console.error);
      term.focus();
    }
  }, [active, id]);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    dragOverRef.current = true;
    setIsDragOver(true);
  }

  function handleDragLeave() {
    dragOverRef.current = false;
    setIsDragOver(false);
  }

  return (
    <div
      style={{ width: "100%", height: "100%", position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => e.preventDefault()}
    >
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", padding: "4px" }}
      />
      {isDragOver && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(201, 125, 58, 0.12)",
          border: "2px dashed #c97d3a",
          borderRadius: "4px",
          pointerEvents: "none",
          zIndex: 10,
        }}>
          <span style={{ color: "#c97d3a", fontSize: "13px", fontFamily: "monospace" }}>
            drop to insert path
          </span>
        </div>
      )}
    </div>
  );
});

export default Terminal;
