import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { terminalAtPoint } from "../lib/screenshotDrag";
import "./ScreenshotBar.css";

type Shot = { path: string; name: string; modified: number };
type Listing = { folder: string; files: Shot[] };
const thumbnails = new Map<string, string>();

function Thumbnail({ shot, size = 160 }: { shot: Shot; size?: number }) {
  const key = `${shot.path}:${shot.modified}:${size}`;
  const [src, setSrc] = useState(thumbnails.get(key));
  useEffect(() => {
    let disposed = false;
    if (thumbnails.has(key)) { setSrc(thumbnails.get(key)); return; }
    setSrc(undefined);
    void invoke<string>("screenshot_thumbnail", { path: shot.path, size }).then((value) => {
      if (thumbnails.size > 90) thumbnails.delete(thumbnails.keys().next().value!);
      thumbnails.set(key, value);
      if (!disposed) setSrc(value);
    }).catch(() => {});
    return () => { disposed = true; };
  }, [key, shot.path, size]);
  return src ? <img src={src} alt={shot.name} draggable={false} /> : <span className="shot-placeholder">▧</span>;
}

export default function ScreenshotBar({ active }: { active: boolean }) {
  const [folder, setFolder] = useState(() => localStorage.getItem("mosaic-screenshot-folder") ?? "");
  const [listing, setListing] = useState<Listing>({ folder: "", files: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState<{ shot: Shot; count: number; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ shot: Shot; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setFolder(localStorage.getItem("mosaic-screenshot-folder") ?? "");
    window.addEventListener("mosaic-screenshot-folder", sync);
    return () => window.removeEventListener("mosaic-screenshot-folder", sync);
  }, []);

  useEffect(() => {
    if (!active || !isTauri()) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await invoke<Listing>("list_screenshots", { folder: folder || null });
        if (!disposed) { setListing(result); setError(""); }
      } catch (e) { if (!disposed) { setListing({ folder, files: [] }); setError(String(e)); } }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [folder, active]);

  async function chooseFolder() {
    try {
      const path = await open({ directory: true, multiple: false, defaultPath: listing.folder || undefined, title: "Choose screenshot folder" });
      if (typeof path !== "string") return;
      localStorage.setItem("mosaic-screenshot-folder", path);
      window.dispatchEvent(new Event("mosaic-screenshot-folder"));
      strip.current?.scrollTo(0, 0);
    } catch (e) { setError(String(e)); }
  }

  // Drop selections whose files rolled out of the listing; Escape clears.
  useEffect(() => {
    setSelected((cur) => {
      const present = new Set(listing.files.map((f) => f.path));
      const next = new Set([...cur].filter((p) => present.has(p)));
      return next.size === cur.size ? cur : next;
    });
  }, [listing]);

  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(new Set()); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function toggleSelected(path: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  const dragCleanup = useRef<() => void>(() => {});
  useEffect(() => () => dragCleanup.current(), []);
  function beginDrag(event: React.PointerEvent, shot: Shot) {
    if (event.button !== 0 || event.shiftKey) return;
    event.preventDefault();
    // dragging part of a multi-selection carries the whole selection
    const paths = selected.has(shot.path)
      ? listing.files.filter((f) => selected.has(f.path)).map((f) => f.path)
      : [shot.path];
    dragCleanup.current();
    suppressClick.current = false;
    const origin = { x: event.clientX, y: event.clientY };
    let moved = false;
    let target: HTMLElement | null = null;
    const clearTarget = () => { target?.classList.remove("screenshot-drop-target"); target = null; };
    const cleanup = () => {
      clearTarget();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
    };
    const move = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 5) return;
      moved = true;
      setDrag({ shot, count: paths.length, x: e.clientX, y: e.clientY });
      clearTarget();
      target = terminalAtPoint(e.clientX, e.clientY);
      target?.classList.add("screenshot-drop-target");
    };
    const up = (e: PointerEvent) => {
      if (moved) {
        suppressClick.current = true;
        const terminal = terminalAtPoint(e.clientX, e.clientY);
        if (terminal) window.dispatchEvent(new CustomEvent("mosaic-insert-screenshot", { detail: { id: terminal.dataset.terminalId, paths } }));
        if (terminal && paths.length > 1) setSelected(new Set());
      }
      setDrag(null);
      cleanup();
    };
    const cancel = () => { setDrag(null); cleanup(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    dragCleanup.current = cleanup;
  }

  return <div className="screenshot-bar" aria-label="Recent screenshots">
    <button className="screenshot-folder" onClick={() => void chooseFolder()} title={`Screenshot folder: ${listing.folder || folder || "Desktop/Screenshots"}\nClick to change folder`}>▧</button>
    <div className="screenshot-strip" ref={strip} onWheel={(e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.currentTarget.scrollLeft += e.deltaY; }
    }}>
      {error ? <button className="screenshot-empty" title={error} onClick={() => void chooseFolder()}>Folder unavailable · choose folder</button> : listing.files.length === 0 ?
        <button className="screenshot-empty" onClick={() => void chooseFolder()}>Screenshots · choose folder</button> :
        listing.files.map((shot) => <button key={shot.path} className={`screenshot-thumb ${selected.has(shot.path) ? "screenshot-thumb-selected" : ""}`} aria-label={shot.name} onPointerEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPreview({ shot, x: r.left + r.width / 2, y: r.bottom + 10 });
        }} onPointerLeave={() => setPreview(null)} onPointerDown={(e) => { setPreview(null); beginDrag(e, shot); }} onClick={(e) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (e.shiftKey) { toggleSelected(shot.path); return; }
          setSelected(new Set());
          void writeText(shot.path).then(() => setMessage("Path copied")).catch((e) => setError(String(e)));
        }}><Thumbnail shot={shot} /></button>)}
    </div>
    <span className="screenshot-total" title={message || `${listing.files.length} recent screenshots · newest first`}>{selected.size ? `${selected.size} selected` : `${listing.files.length}/30`}</span>
    {preview && !drag && createPortal(<div
      key={preview.shot.path}
      className="screenshot-preview"
      style={{ left: Math.min(Math.max(preview.x, 250), window.innerWidth - 250), top: preview.y }}
    >
      <Thumbnail shot={preview.shot} size={900} />
      <span className="screenshot-preview-name">{preview.shot.name} · drag to a terminal · click to copy · shift-click to select</span>
    </div>, document.body)}
    {drag && createPortal(<div className="screenshot-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}><Thumbnail shot={drag.shot} /><span>{drag.count > 1 ? `Drop to insert ${drag.count} paths` : "Drop to insert path"}</span></div>, document.body)}
  </div>;
}
