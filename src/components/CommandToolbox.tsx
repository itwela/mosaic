import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { v4 as uuidv4 } from "uuid";
import { SavedCommand } from "../types";
import "./CommandToolbox.css";

interface Props {
  tabTitle: string;
  commands: SavedCommand[];
  onClose: () => void;
  onAdd: (cmd: SavedCommand) => void;
  onDelete: (id: string) => void;
}

export default function CommandToolbox({ tabTitle, commands, onClose, onAdd, onDelete }: Props) {
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function copy(cmd: SavedCommand) {
    try {
      await writeText(cmd.text);
      setCopiedId(cmd.id);
      setTimeout(() => setCopiedId((cur) => (cur === cmd.id ? null : cur)), 1200);
    } catch (err) {
      console.error(err);
    }
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd({ id: uuidv4(), label: label.trim() || undefined, text: trimmed });
    setLabel("");
    setText("");
  }

  return (
    <div
      className="toolbox-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="toolbox-modal">
        <div className="toolbox-header">
          <span className="toolbox-title">
            Command Toolbox <span className="toolbox-tab-title">— {tabTitle}</span>
          </span>
          <button className="toolbox-close" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="toolbox-list">
          {commands.length === 0 ? (
            <div className="toolbox-empty">No saved commands yet for this terminal.</div>
          ) : (
            commands.map((cmd) => (
              <div className="toolbox-item" key={cmd.id}>
                <div className="toolbox-item-text" onClick={() => copy(cmd)} title="Click to copy">
                  {cmd.label && <div className="toolbox-item-label">{cmd.label}</div>}
                  <code className="toolbox-item-command">{cmd.text}</code>
                </div>
                <div className="toolbox-item-actions">
                  <button className="toolbox-copy-btn" onClick={() => copy(cmd)}>
                    {copiedId === cmd.id ? "Copied" : "Copy"}
                  </button>
                  <button className="toolbox-delete-btn" onClick={() => onDelete(cmd.id)} title="Delete">
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <form className="toolbox-add-form" onSubmit={submitAdd}>
          <input
            className="toolbox-add-label"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <textarea
            className="toolbox-add-text"
            placeholder="Command or prompt..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAdd(e);
            }}
          />
          <button className="toolbox-add-btn" type="submit" disabled={!text.trim()}>
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
