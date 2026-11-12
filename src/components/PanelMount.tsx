import { useLayoutEffect, useRef } from "react";

// Layout slots may remount at a breakpoint. The panel's portal and its DOM stay
// alive, so moving between slots never restarts a shell or refetches usage.
export default function PanelMount({ content }: { content: HTMLDivElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const parent = slot.current!;
    const wasAttached = content.dataset.attached === "true";
    parent.appendChild(content);
    // Webviews can discard an iframe's document when its slot is detached.
    // Reapply the saved URL after a move; the pane's selected list and notes
    // are persisted by Field notes using its stable view ID.
    if (wasAttached) content.querySelectorAll<HTMLIFrameElement>('iframe[src^="/fieldnotes/"]').forEach(frame => {
      frame.src = frame.getAttribute("src")!;
    });
    content.dataset.attached = "true";
    return () => { if (content.parentNode === parent) parent.removeChild(content); };
  }, [content]);
  return <div ref={slot} className="window-frame" />;
}
