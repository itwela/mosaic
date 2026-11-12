import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { useFieldnotesDrop } from "../lib/fieldnotesFrame";
import "./FieldnotesView.css";

// "CRESCENT · VOUS ÊTES HÉRITAGE" -> "Crescent": the group the client sits under.
function groupOf(eyebrow: string): string {
  const first = eyebrow.split("·")[0].trim().toLowerCase();
  return first.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export default function FieldnotesView({ visible, onToggleScreenshot }: { visible: boolean; onToggleScreenshot?: () => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [group, setGroup] = useState("");
  useFieldnotesDrop(frameRef, visible);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow || e.data?.type !== "fieldnotes-client") return;
      setGroup(groupOf(String(e.data.eyebrow ?? "")));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="fieldnotes-view" style={{ display: visible ? "flex" : "none" }}>
      <header className="page-bar" data-tauri-drag-region>
        <h1 className="page-bar-title">Field notes</h1>
        {group && <span className="page-bar-sub">{group}</span>}
        <button className="grid-add-launcher compact-only" title="Field notes tools" onClick={() => frameRef.current?.contentWindow?.postMessage({ type: "fieldnotes-tools" }, location.origin)}><Icon name="more" /></button>
        <button className="grid-add-panel compact-only" title="Add a field note" onClick={() => frameRef.current?.contentWindow?.postMessage({ type: "fieldnotes-add" }, location.origin)}><Icon name="plus" /></button>
        {onToggleScreenshot && (
          <div className="grid-toolbar-actions">
            <button className="grid-tuck-btn" onClick={onToggleScreenshot} title="Tuck to corner (⌘⇧S)">
              <Icon name="tuck" />tuck
            </button>
          </div>
        )}
      </header>
      <div className="page-sheet">
        <iframe ref={frameRef} className="fieldnotes-frame" src="/fieldnotes/index.html" title="Field notes" />
      </div>
    </div>
  );
}
