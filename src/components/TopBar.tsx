import { useEffect, useState } from "react";
import ScreenshotBar from "./ScreenshotBar";

interface Props {
  title: string;
  onAddTerminal: () => void;
  onAddLauncher: () => void;
  onAddUsage: () => void;
  onAddFieldnotes: () => void;
  onAddZen: () => void;
  onTuck: () => void;
}

function Clock() {
  const [text, setText] = useState(() => new Date().toTimeString().slice(0, 8));
  useEffect(() => {
    const timer = window.setInterval(() => setText(new Date().toTimeString().slice(0, 8)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="top-clock">{text}</span>;
}

export default function TopBar({ title, onAddTerminal, onAddLauncher, onAddUsage, onAddFieldnotes, onAddZen, onTuck }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".win-menu-wrap")) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  function add(run: () => void) {
    setMenuOpen(false);
    run();
  }

  return (
    <header className="topbar">
      <span className="top-title">{title}</span>
      <ScreenshotBar active />
      <button
        className="tbtn"
        title="Hide current screenshots from the strip. Files stay in the folder."
        onClick={() => window.dispatchEvent(new Event("mosaic-clear-shots"))}
      >
        Clear all
      </button>
      <span className="top-spacer" />
      <Clock />
      <button className="tbtn" title="Add terminal panel" onClick={onAddTerminal}>+ Terminal</button>
      <div className="win-menu-wrap">
        <button className={`tbtn ${menuOpen ? "is-open" : ""}`} title="Add a window" onClick={() => setMenuOpen((open) => !open)}>+ Window ▾</button>
        {menuOpen && (
          <div className="win-menu">
            <button onClick={() => add(onAddTerminal)}>▣ Terminal</button>
            <button onClick={() => add(onAddLauncher)}>▤ Launcher board</button>
            <button onClick={() => add(onAddUsage)}>◔ AI usage</button>
            <button onClick={() => add(onAddFieldnotes)}>☑ Field notes</button>
            <button onClick={() => add(onAddZen)}>◎ Zen Studio</button>
          </div>
        )}
      </div>
      <button className="tbtn tbtn-pri" title="Tuck to corner (⌘⇧S)" onClick={onTuck}>⤡ Tuck</button>
    </header>
  );
}
