import "./HelpView.css";

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
];

export default function HelpView() {
  return (
    <div className="help-view">
      <div className="help-card">
        <div className="help-eyebrow">What is this</div>
        <h1 className="help-title">mosaic</h1>
        <p className="help-lead">
          A desktop terminal workspace manager. Instead of a pile of
          unnamed terminal windows you lose track of, Mosaic gives every
          session a home. Organized by workspace, split into panels,
          tabbed however you need.
        </p>

        <p className="help-body">
          The idea is simple: the way you work has structure. A workspace
          for one project, another for something else. Mosaic keeps that
          structure intact so switching contexts is a single click, not a
          hunt through windows.
        </p>

        <div className="help-concepts">
          {concepts.map((c) => (
            <div key={c.label} className="help-concept">
              <span className="help-concept-label">{c.label}</span>
              <span className="help-concept-desc">{c.desc}</span>
            </div>
          ))}
        </div>

        <p className="help-footer">
          Everything saves automatically. Close it, reopen it and your
          workspaces are exactly where you left them.
        </p>
      </div>
    </div>
  );
}
