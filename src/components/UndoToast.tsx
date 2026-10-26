import { useEffect } from "react";
import { dismissEntry, undoEntry, undoLatest, useUndoEntries } from "../store/undo";
import "./UndoToast.css";

export default function UndoToast() {
  const entries = useUndoEntries();

  // Cmd/Ctrl+Z undoes the latest deletion while one is pending. Capture phase so
  // it still works when a terminal has focus; terminals never see Cmd+Z anyway.
  useEffect(() => {
    if (entries.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const target = e.target as HTMLElement;
        if (target.closest("input:not(.xterm-helper-textarea), textarea:not(.xterm-helper-textarea)")) return;
        if (undoLatest()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="undo-stack">
      {entries.slice(-3).map((entry) => (
        <div key={entry.id} className="undo-toast">
          <span className="undo-label">{entry.label}</span>
          <button className="undo-btn" onClick={() => undoEntry(entry.id)}>Undo</button>
          <button className="undo-dismiss" onClick={() => dismissEntry(entry.id)} title="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
