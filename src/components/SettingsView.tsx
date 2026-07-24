import { useEffect, useState } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import "./SettingsView.css";

export default function SettingsView() {
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    isEnabled().then((v) => {
      setLaunchAtLogin(v);
      setLoading(false);
    });
  }, []);

  async function toggleLaunchAtLogin() {
    const next = !launchAtLogin;
    setLaunchAtLogin(next);
    if (next) await enable();
    else await disable();
  }

  return (
    <div className="settings-view">
      <div className="settings-card">
        <div className="settings-eyebrow">Settings</div>
        <h1 className="settings-title">Preferences</h1>

        <div className="settings-section">
          <div className="settings-section-label">Startup</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-name">Launch at login</span>
              <span className="settings-row-desc">Open mosaic automatically when you log in</span>
            </div>
            <button
              className={`toggle ${launchAtLogin ? "toggle-on" : ""}`}
              onClick={toggleLaunchAtLogin}
              disabled={loading}
              aria-label="Toggle launch at login"
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
