import { CSSProperties, ReactNode, useRef, useState } from "react";

export type PaneDimensions = { width: number; height: number; centered: boolean };
// Compact panes may not grow taller than the scrolling column they sit in,
// otherwise the resize handle ends up off-screen and the pane can't be shrunk back.
function compactMax(el: HTMLElement | null) {
  const stack = el?.parentElement;
  return stack ? Math.max(160, stack.clientHeight - 16) : 1400;
}
export default function PaneSize({ children, initial, centered, compact, onSave }: {
  children: ReactNode; initial?: PaneDimensions; centered: boolean; compact?: boolean;
  onSave: (size: PaneDimensions) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initial);
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  return <div ref={root} className={`sized-pane${compact ? " sized-pane-compact" : ""}`} style={{ width: compact ? "100%" : size?.width, height: size?.height, maxHeight: compact ? "calc(100% - 16px)" : undefined, margin: centered && !compact ? "auto" : undefined } as CSSProperties}>
    {children}
    <button className="pane-size-handle" aria-label={compact ? "Resize panel height" : "Resize panel"} title={compact ? "Drag to change height · arrow keys to resize" : "Drag to resize · arrow keys to resize"}
      onPointerDown={e => {
        if (e.button !== 0 || drag.current) return;
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const r = root.current!.getBoundingClientRect();
        drag.current = { x: e.clientX, y: e.clientY, width: r.width, height: r.height };
        document.documentElement.classList.add("pane-resizing");
        window.getSelection()?.removeAllRanges();
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return;
        const parent = root.current!.parentElement!.getBoundingClientRect();
        const next = { width: compact ? parent.width : Math.max(240, Math.min(parent.width, d.width + (e.clientX-d.x) * (centered ? 2 : 1))), height: Math.max(160, Math.min(compact ? compactMax(root.current) : parent.height, d.height + (e.clientY-d.y) * (centered ? 2 : 1))), centered };
        setSize(next);
      }}
      onPointerUp={e => { if (!drag.current) return; drag.current = null; document.documentElement.classList.remove("pane-resizing"); const r = root.current!.getBoundingClientRect(); onSave({ width: r.width, height: r.height, centered }); e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; document.documentElement.classList.remove("pane-resizing"); }}
      onKeyDown={e => {
        if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
        e.preventDefault(); const r = root.current!.getBoundingClientRect(); const p = root.current!.parentElement!.getBoundingClientRect();
        const next = { width: compact ? p.width : Math.max(240, Math.min(p.width, r.width + (e.key === "ArrowRight" ? 24 : e.key === "ArrowLeft" ? -24 : 0))), height: Math.max(160, Math.min(compact ? compactMax(root.current) : p.height, r.height + (e.key === "ArrowDown" ? 24 : e.key === "ArrowUp" ? -24 : 0))), centered };
        setSize(next); onSave(next);
      }}><span /> </button>
  </div>;
}
