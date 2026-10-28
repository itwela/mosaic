import { RefObject, useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type FieldnotesWindow = Window & { __fieldnotesDrop?: (event: unknown) => void };

// Fieldnotes (public/fieldnotes) runs as-is in an iframe. Native file drops
// land on Mosaic's webview, so forward the ones over this frame, with the
// position shifted into the frame's coordinates.
export function useFieldnotesDrop(frameRef: RefObject<HTMLIFrameElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const frame = frameRef.current;
        const target = frame?.contentWindow as FieldnotesWindow | null | undefined;
        if (!frame || !target?.__fieldnotesDrop) return;
        const payload = event.payload as { type: string; position?: { x: number; y: number } };
        if (payload.position) {
          const dpr = window.devicePixelRatio;
          const rect = frame.getBoundingClientRect();
          const x = payload.position.x / dpr - rect.left;
          const y = payload.position.y / dpr - rect.top;
          // Outside this frame: tell it the drag left so it clears highlights.
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
            target.__fieldnotesDrop({ ...event, payload: { type: "leave" } });
            return;
          }
          const scale = dpr / (target.devicePixelRatio || dpr);
          payload.position = { x: x * dpr / scale, y: y * dpr / scale };
        }
        target.__fieldnotesDrop({ ...event, payload });
      })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, frameRef]);
}
