import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@xterm/xterm/css/xterm.css";
import { detectScreenState, notificationState } from "../lib/agents";
import { quoteForShell } from "../lib/screenshotDrag";

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

// Live terminals by tab id, so the "All running" view can borrow a terminal's
// DOM into its own grid and hand it back afterwards. Moving the element keeps
// the scrollback, the shell and the xterm instance; only the host changes.
interface LiveTerminal {
  element: HTMLElement;
  home: HTMLElement;
  observe: (host: HTMLElement) => void;
  unobserve: (host: HTMLElement) => void;
  refit: () => void;
}
const live = new Map<string, LiveTerminal>();

export function adoptTerminal(id: string, host: HTMLElement): boolean {
  const t = live.get(id);
  if (!t) return false;
  if (t.element.parentElement !== host) host.appendChild(t.element);
  t.observe(host);
  t.refit();
  return true;
}

export function releaseTerminal(id: string, host: HTMLElement) {
  const t = live.get(id);
  if (!t) return;
  t.unobserve(host);
  if (t.element.parentElement === host) {
    t.home.appendChild(t.element);
    t.refit();
  }
}

// Match what a normal terminal does with a dropped file: hand the shell a path
// it can actually run, quoting only when the path has something the shell would
// otherwise interpret.

const Terminal = forwardRef<TerminalHandle, Props>(function Terminal({ id, active, cwd }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const prevCwdRef = useRef<string | undefined>(cwd);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // Deliberately NOT allowTransparency. Nothing here is actually see-through
      // — the theme background, .terminal-panel and the Tauri window are all the
      // same opaque #0e0a07 — but the flag makes xterm stop painting opaque row
      // backgrounds, and WebKit then leaves stale glyph pixels behind whenever
      // the buffer scrolls. That's the garbling that only a full repaint clears.
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    const home = containerRef.current;

    // FitAddon measures the terminal's parent with getComputedStyle. Under a
    // display:none workspace that returns the *specified* "100%", which it
    // reads as 100px, so hidden terminals were squeezed to ~10 columns and the
    // shell redrew everything into the top-left corner. Only fit real boxes.
    let lastSize = "";
    const refit = () => {
      const host = term.element?.parentElement;
      if (!host || host.clientWidth < 40 || host.clientHeight < 30) return;
      fit.fit();
      const size = `${term.cols}x${term.rows}`;
      if (size === lastSize) return;
      lastSize = size;
      invoke("pty_resize", { id, cols: term.cols, rows: term.rows })
        // The shell only redraws for the new size once the resize lands.
        .then(() => term.refresh(0, term.rows - 1))
        .catch(console.error);
    };
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    mountedRef.current = true;
    prevCwdRef.current = cwd;

    const visible = home.clientWidth >= 40 && home.clientHeight >= 30;
    const cols = visible ? term.cols : 120;
    const rows = visible ? term.rows : 32;
    if (!visible) term.resize(cols, rows);
    lastSize = `${cols}x${rows}`;
    invoke("pty_create", { id, cols, rows, cwd: cwd ?? null }).catch(console.error);

    // Agents announce "needs approval" / "turn finished" as desktop
    // notifications (OSC 9, or OSC 777;notify). That's a far better signal
    // than guessing from the screen, so forward it.
    const notify = (text: string) => {
      window.dispatchEvent(new CustomEvent("mosaic-agent-notify", {
        detail: { id, state: notificationState(text), at: Date.now() },
      }));
      return true;
    };
    term.parser.registerOscHandler(9, (data) => {
      // OSC 9;4 is ConEmu's progress bar, not a notification.
      if (/^4;/.test(data)) return false;
      return notify(data);
    });
    term.parser.registerOscHandler(777, (data) => {
      if (!data.startsWith("notify;")) return false;
      return notify(data.slice(7));
    });

    let screenTimer: ReturnType<typeof setTimeout> | null = null;
    let lastScreenState = "";
    const publishScreen = () => {
      const buffer = term.buffer.active;
      const lines: string[] = [];
      // baseY follows the live screen even if the user scrolls into history.
      for (let row = buffer.baseY; row < buffer.baseY + term.rows; row++) {
        lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
      }
      const state = detectScreenState(lines.join("\n"));
      if (state !== lastScreenState) {
        lastScreenState = state;
        window.dispatchEvent(new CustomEvent("mosaic-agent-screen", { detail: { id, state } }));
      }
    };
    const screenInterval = setInterval(publishScreen, 1000);
    term.onData((data) => {
      invoke("pty_write", { id, data }).catch(console.error);
      window.dispatchEvent(new CustomEvent("mosaic-agent-input", { detail: { id, at: Date.now() } }));
    });

    let unlisten1: (() => void) | null = null;
    let unlisten2: (() => void) | null = null;
    let unlisten3: (() => void) | null = null;

    listen<string>(`pty-data-${id}`, (event) => {
      term.write(event.payload, () => {
        if (screenTimer) clearTimeout(screenTimer);
        screenTimer = setTimeout(publishScreen, 100);
      });
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
      // Coalesce a live panel drag into one fit per frame and one PTY resize
      // once it settles; refit() skips hidden (zero-size) hosts entirely.
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const host = term.element?.parentElement;
        if (host && host.clientWidth >= 40 && host.clientHeight >= 30) fit.fit();
      });
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(refit, 50);
    });
    ro.observe(containerRef.current);

    if (term.element) {
      live.set(id, {
        element: term.element,
        home,
        observe: (host) => ro.observe(host),
        unobserve: (host) => ro.unobserve(host),
        refit,
      });
      window.dispatchEvent(new CustomEvent("mosaic-terminal-live", { detail: { id } }));
    }

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (live.get(id)?.element === term.element) live.delete(id);
      if (screenTimer) clearTimeout(screenTimer);
      clearInterval(screenInterval);
      ro.disconnect();
      unlisten1?.();
      unlisten2?.();
      unlisten3?.();
      mountedRef.current = false;
      // NOTE: we do NOT kill the PTY here. The session stays alive in Rust so a
      // panel reorder (which remounts this component) reattaches to the same
      // shell. Closing a tab/panel/workspace kills it explicitly instead.
      term.dispose();
    };
  }, [id]);

  useEffect(() => {
    const insert = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; paths: string[] }>).detail;
      if (detail.id !== id) return;
      const data = detail.paths.map((path) => `${quoteForShell(path)} `).join("");
      invoke("pty_write", { id, data }).catch(console.error);
      termRef.current?.focus();
    };
    window.addEventListener("mosaic-insert-screenshot", insert);
    return () => window.removeEventListener("mosaic-insert-screenshot", insert);
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
    if (active && termRef.current) {
      // The tab was display:none while inactive; size it to its real box now.
      live.get(id)?.refit();
      termRef.current.refresh(0, termRef.current.rows - 1);
      termRef.current.focus();
    }
  }, [active, id]);

  // Hover a terminal for 3s to focus it, so you can type without clicking.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  function handleMouseEnter() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      termRef.current?.focus();
    }, 3000);
  }

  function handleMouseLeave() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }

  return (
    <div
      ref={rootRef}
      className="terminal-root"
      data-terminal-id={id}
      style={{ width: "100%", height: "100%", position: "relative" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
