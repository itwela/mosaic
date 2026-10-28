import { useRef } from "react";
import { useFieldnotesDrop } from "../lib/fieldnotesFrame";
import "./FieldnotesView.css";

interface Props {
  viewId: string;
  panelIndex: number;
  active: boolean;
  onReorderStart: (index: number, x: number, y: number) => void;
  onClosePanel: () => void;
}

// Field notes as a workspace window. Each pane keeps its own client and list.
export default function FieldnotesPanel({ viewId, panelIndex, active, onReorderStart, onClosePanel }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useFieldnotesDrop(frameRef, active);

  return (
    <div className="launcher-panel fieldnotes-panel">
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
        <span className="fieldnotes-panel-title">Field notes</span>
        <button className="launcher-panel-close-btn" onClick={onClosePanel} title="Close panel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <iframe
        ref={frameRef}
        className="fieldnotes-frame"
        src={`/fieldnotes/index.html?pane=${encodeURIComponent(viewId)}`}
        title="Field notes"
      />
    </div>
  );
}
