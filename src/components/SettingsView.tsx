import { useEffect, useState } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { setTheme, THEMES, useTheme } from "../lib/theme";
import "./SettingsView.css";

export default function SettingsView() {
  const theme = useTheme();
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [loading, setLoading] = useState(true);

  const [hooksInstalled, setHooksInstalled] = useState<boolean | null>(null);
  const [hooksError, setHooksError] = useState("");

  useEffect(() => {
    invoke<boolean>("agent_hooks_installed").then(setHooksInstalled).catch(() => setHooksInstalled(false));
  }, []);

  async function installHooks() {
    setHooksError("");
    try {
      await invoke("install_agent_hooks");
      setHooksInstalled(true);
    } catch (e) {
      setHooksError(String(e));
    }
  }

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
          <div className="settings-section-label">Theme</div>
          <div className="theme-options">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-option ${theme === t.id ? "theme-option-active" : ""}`}
                onClick={() => setTheme(t.id)}
                aria-pressed={theme === t.id}
              >
                <span className={`theme-swatch theme-swatch-${t.id}`} />
                <span className="theme-option-name">{t.name}</span>
                <span className="theme-option-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

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

        <div className="settings-section">
          <div className="settings-section-label">Agent status</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-name">Claude Code status hooks</span>
              <span className="settings-row-desc">
                Claude Code reports exactly when it is working, finished, or waiting for your approval,
                instead of Mosaic guessing from the screen. Adds hooks to ~/.claude/settings.json
                (backed up first). They do nothing outside Mosaic. Restart running Claude sessions after installing.
              </span>
              {hooksError && <span className="settings-row-desc settings-error">{hooksError}</span>}
            </div>
            <button className="settings-action" onClick={installHooks} disabled={hooksInstalled === null}>
              {hooksInstalled ? "Reinstall" : "Install"}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-name">Codex approvals</span>
              <span className="settings-row-desc">
                Mosaic listens for Codex's terminal notifications. Turn them on with
                <code> [tui] notifications = true </code> in ~/.codex/config.toml.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
