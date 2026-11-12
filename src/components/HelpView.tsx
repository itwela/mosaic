import { useNarrow } from "../lib/useNarrow";
import { useTheme } from "../lib/theme";
import "./HelpView.css";

// The glass each concept's tile is cut from in the Mosaic theme.
const CONCEPT_GLASS = ["ruby", "cobalt", "teal", "violet", "amber", "sea"];
// In the Mosaic theme status is light in the glass, not a dot.
const STATUS_LIGHT = {
  label: "Status light",
  desc: "The glass around a terminal tells you what is happening. Amber means an agent is running. Red means it is waiting on you. Dark means idle. Hover any terminal for a moment and it focuses itself.",
};

const concepts = [
  {
    label: "Workspaces",
    desc: "Named environments for different contexts. A project, a client, a workflow. Switch between them without losing anything.",
  },
  {
    label: "Panels",
    desc: "Split your workspace into multiple terminal panes side by side. Resize them however you need.",
  },
  {
    label: "Tabs",
    desc: "Each panel holds multiple tabs. Stack related sessions inside one pane so things stay grouped.",
  },
  {
    label: "Portable workspaces",
    desc: "Use the down-arrow beside a workspace to export its layout, terminals, tabs, and launcher shortcuts. Import the .mosaic.json file on another computer to add it there.",
  },
  {
    label: "Status dots",
    desc: "A colored dot on each tab and workspace tells you at a glance what's happening. Amber = an agent is running. Red = it's waiting on you. Gray = idle. Hover any terminal for a moment and it focuses itself.",
  },
  {
    label: "Drag to reorder",
    desc: "Drag a workspace in the sidebar, or grab the dotted grip at the left of any panel, to move things around.",
  },
];

const shortcut = {
  keys: "⌘ / Ctrl + Shift + S",
  desc: "Tuck Mosaic into a small bottom-right pill to free up the screen for screenshots. Press it again to restore.",
};

export default function HelpView() {
  const glass = useTheme() === "mosaic";
  const compact = useNarrow() && glass;
  const compactDescriptions = [
    "Named environments for different contexts.",
    "Split your workspace into multiple terminal panes side by side.",
    "Each panel holds multiple tabs.",
    "Use the down-arrow beside a workspace to export its layout, terminals, tabs and launcher shortcuts.",
    "Amber means an agent is running. Red means it is waiting on you. Dark means idle.",
  ];
  return (
    <div className="help-view">
      <div className="help-card">
        <div className="help-eyebrow">What is this</div>
        <h1 className="help-title"><img className="help-mark" src="/textures/glass-art/icon.png" alt="" />mosaic</h1>
        <p className="help-lead">
          {compact ? "A desktop terminal workspace manager. Mosaic gives every session a home: organized by workspace, split into panels, tabbed however you need." : "A desktop terminal workspace manager. Instead of a pile of unnamed terminal windows you lose track of, Mosaic gives every session a home. Organized by workspace, split into panels, tabbed however you need."}
        </p>

        <p className="help-body">
          The idea is simple: the way you work has structure. A workspace
          for one project, another for something else. Mosaic keeps that
          structure intact so switching contexts is a single click, not a
          hunt through windows.
        </p>

        <div className="help-concepts">
          {concepts.map((item, i) => {
            const c = glass && item.label === "Status dots" ? STATUS_LIGHT : item;
            return (
              <div key={c.label} className="help-concept" data-glass={CONCEPT_GLASS[i % CONCEPT_GLASS.length]}>
                <span className="help-concept-label">
                  {c.label}
                  {c === STATUS_LIGHT && <span className="help-lights"><i /><i /><i /></span>}
                </span>
                <span className="help-concept-desc">{compact ? compactDescriptions[i] ?? c.desc : c.desc}</span>
              </div>
            );
          })}
        </div>

        <div className="help-shortcut">
          <span className="help-shortcut-label">Screenshot mode</span>
          <span className="help-shortcut-keys">{shortcut.keys}</span>
          <span className="help-shortcut-desc">{shortcut.desc}<span className="help-shortcut-win"> Ctrl on Windows.</span></span>
          <span className="help-keycaps"><kbd>⌘</kbd><kbd>Shift</kbd><kbd>S</kbd></span>
        </div>

        <p className="help-footer">
          Everything saves automatically. Close it, reopen it and your
          workspaces are exactly where you left them. Exported workspaces
          are portable JSON files you can copy between computers.
        </p>
      </div>
    </div>
  );
}
