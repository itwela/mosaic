import { useEffect, useRef } from "react";
import CommandsView from "./CommandsView";
import "./CommandToolbox.css";

interface Props {
  onClose: () => void;
}

// The terminal toolbox shows the same shared Command Database as the Commands tab.
export default function CommandToolbox({ onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="toolbox-overlay"
      ref={overlayRef}
      onMouseDown={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <CommandsView onClose={onClose} />
    </div>
  );
}
