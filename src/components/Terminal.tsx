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

// Where the pointer was when a file was dragged, in CSS pixels relative to the
// webview. Tauri types this as a physical position, but on macOS wry reports
// AppKit points, which already match CSS pixels; Windows and Linux report real
// device pixels. Only scale on the platforms where the value really is physical.
function toClientPoint(position: { x: number; y: number }) {
  const scale = navigator.userAgent.includes("Mac") ? 1 : window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

function isPointInside(el: HTMLElement | null, position: { x: number; y: number }) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  // A background tab is display:none, so it has no box and can't be a target.
  if (rect.width === 0 || rect.height === 0) return false;
  const { x, y } = toClientPoint(position);
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Match what a normal terminal does with a dropped file: hand the shell a path
// it can actually run, quoting only when the path has something the shell would
// otherwise interpret.
function quoteForShell(path: string) {
  return /^[A-Za-z0-9_./@%+:,=-]+$/.test(path)
    ? path
    : `'${path.replace(/'/g, "'\\''")}'`;
}

const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ id, active, cwd }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const prevCwdRef = useRef<string | undefined>(cwd);
  const [isDragOver, setIsDragOver] = useState(false);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const term = termRef.current;
      if (!term) return;
      // Drop xterm's scrollback so it looks like a fresh launch...
      term.clear();
      // ...then send Ctrl+L (form feed) to the shell itself so it redraws a
      // clean prompt at the top. Unlike term.clear() alone this reaches the
      // shell, so it works in any folder and keeps whatever you'd typed.
      invoke("pty_write", { id, data: "\x0c" }).catch(console.error);
    },
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

    // Tauri swallows native file drags before the webview sees them, so the
    // HTML5 dragover/drop events never fire for files and this window-level
    // event is the only signal we get. It's broadcast to every open terminal,
    // so each one hit-tests the pointer against its own box and only the
    // terminal actually under the cursor reacts.
    getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;

      if (payload.type === "leave") {
        setIsDragOver(false);
        return;
      }

      const over = isPointInside(rootRef.current, payload.position);

      if (payload.type === "enter" || payload.type === "over") {
        setIsDragOver(over);
        return;
      }

      // drop
      setIsDragOver(false);
      if (!over) return;
      const text = payload.paths.map(quoteForShell).join(" ");
      if (!text) return;
      // Trailing space so the next thing typed doesn't glue onto the path.
      invoke("pty_write", { id, data: `${text} ` }).catch(console.error);
      term.focus();
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

  return (
    <div
      ref={rootRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      // Files are handled by the Tauri drag-drop event above; these only stop
      // the webview from navigating away if something else (a URL, a text
      // selection) gets dropped on the terminal.
      onDragOver={(e) => e.preventDefault()}
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
