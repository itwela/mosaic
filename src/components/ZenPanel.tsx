import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./FieldnotesView.css";
import "./ZenPanel.css";

interface Props {
  panelIndex: number;
  onReorderStart: (index: number, x: number, y: number) => void;
  onClosePanel: () => void;
}

// Zen Studio's own Tauri app serves its studio on this port (zen-studio/src-tauri/src/lib.rs).
const ZEN_URL = "http://localhost:3003/";
const ZEN_APP = "/Applications/Zen Studio.app";

// Zen Studio as a workspace window: the running studio, embedded.
export default function ZenPanel({ panelIndex, onReorderStart, onClosePanel }: Props) {
  const [up, setUp] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [launching, setLaunching] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Poll until the studio answers; an opaque no-cors response is enough to know it's there.
  useEffect(() => {
    if (up) return;
    let stop = false;
    const check = () =>
      fetch(ZEN_URL, { mode: "no-cors" })
        .then(() => !stop && setUp(true))
        .catch(() => !stop && setUp(false));
    check();
    const t = window.setInterval(check, 2000);
    return () => { stop = true; window.clearInterval(t); };
  }, [up]);

  // open_path doesn't report a missing app, so if the studio hasn't answered a while
  // after launching, say how to get it.
  useEffect(() => {
    if (!launching || up) return;
    const t = window.setTimeout(
      () => setError("Still not running. Build the app with `npm run app` in zen-studio, then try again."),
      12000,
    );
    return () => window.clearTimeout(t);
  }, [launching, up]);

  async function openApp() {
    setError("");
    setLaunching(true);
    await invoke("open_path", { path: ZEN_APP }).catch((e) => setError(String(e)));
  }

  return (
    <div className="launcher-panel fieldnotes-panel zen-panel">
      <div className="launcher-header">
        <button
          className="panel-drag-grip"
          title="Drag to reorder panel"
          onPointerDown={(e) => {
            e.preventDefault();
            onReorderStart(panelIndex, e.clientX, e.clientY);
          }}
        >
          <span className="grip-dots">⠿</span>
        </button>
        <span className="fieldnotes-panel-title">Zen Studio</span>
        {up && (
          <button
            className="launcher-panel-close-btn"
            title="Reload"
            onClick={() => frameRef.current && (frameRef.current.src = ZEN_URL)}
          >
            ↻
          </button>
        )}
        <button className="launcher-panel-close-btn" onClick={onClosePanel} title="Close panel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      {up ? (
        <iframe ref={frameRef} className="fieldnotes-frame" src={ZEN_URL} title="Zen Studio" />
      ) : (
        <div className="zen-panel-empty">
          <p>{up === null ? "Looking for Zen Studio…" : launching ? "Starting Zen Studio…" : "Zen Studio isn't running."}</p>
          {up === false && !launching && <button onClick={openApp}>Open Zen Studio</button>}
          {error && <p className="zen-panel-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
