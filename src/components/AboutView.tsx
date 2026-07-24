import "./AboutView.css";

export default function AboutView() {
  return (
    <div className="about-view">
      <div className="about-card">
        <img src="/cc-logo.svg" alt="Caveman Creative" className="about-logo-img" />
        <h1 className="about-brand">Caveman Creative</h1>
        <div className="about-est">Est. 2026</div>
        <div className="about-divider" />
        <p className="about-tagline">Making tech make sense.</p>
        <div className="about-meta">
          <span>Technology</span>
          <span className="about-dot">·</span>
          <span>Education</span>
          <span className="about-dot">·</span>
          <span>Productivity</span>
        </div>
        <div className="about-handle">@cavemancreativehq</div>
      </div>
    </div>
  );
}
