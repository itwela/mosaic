import { useRef } from "react";
import { useFieldnotesDrop } from "../lib/fieldnotesFrame";
import "./FieldnotesView.css";

export default function FieldnotesView({ visible }: { visible: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useFieldnotesDrop(frameRef, visible);

  return (
    <div className="fieldnotes-view" style={{ display: visible ? "flex" : "none" }}>
      <iframe ref={frameRef} className="fieldnotes-frame" src="/fieldnotes/index.html" title="Field notes" />
    </div>
  );
}
