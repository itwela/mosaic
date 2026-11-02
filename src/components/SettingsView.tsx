import { useEffect, useState } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AERO_WALLPAPERS, setTheme, setWallpaper, THEMES, useTheme, useWallpaper } from "../lib/theme";
import "./SettingsView.css";

function shortPath(path: string) {
  if (!path) return "Not set";
  const home = path.match(/^\/Users\/[^/]+/);
  const display = home ? `~${path.slice(home[0].length)}` : path;
  if (display.length <= 42) return display;
  return `…${display.slice(-40)}`;
}

export default function SettingsView() {
  const theme = useTheme();
  const wallpaper = useWallpaper();
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [screenshotFolder, setScreenshotFolder] = useState(
    () => localStorage.getItem("mosaic-screenshot-folder") ?? "",
  );
  const [privacyError, setPrivacyError] = useState("");

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

  async function chooseScreenshotFolder() {
    setPrivacyError("");
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: screenshotFolder || undefined,
        title: "Choose screenshot folder",
      });
      if (typeof path !== "string") return;
      localStorage.setItem("mosaic-screenshot-folder", path);
      window.dispatchEvent(new Event("mosaic-screenshot-folder"));
      setScreenshotFolder(path);
    } catch (e) {
      setPrivacyError(String(e));
    }
  }

  function clearScreenshotFolder() {
    localStorage.removeItem("mosaic-screenshot-folder");
    window.dispatchEvent(new Event("mosaic-screenshot-folder"));
    setScreenshotFolder("");
  }

  async function openPrivacySettings() {
    setPrivacyError("");
    try {
      await invoke("open_privacy_settings");
    } catch (e) {
      setPrivacyError(String(e));
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-card">
        <div className="settings-eyebrow">Settings</div>
        <h1 className="settings-title">Preferences</h1>

        <div className="settings-section">
          <div className="settings-section-label">Privacy</div>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-name">Screenshot folder</span>
              <span className="settings-row-desc">
                Pick once. Mosaic only watches this folder — it no longer scans Desktop by default.
              </span>
              <span className="settings-row-desc">{shortPath(screenshotFolder)}</span>
              {privacyError && <span className="settings-row-desc settings-error">{privacyError}</span>}
            </div>
            <div className="settings-actions">
              <button className="settings-action" onClick={() => void chooseScreenshotFolder()}>
                Choose
              </button>
              {screenshotFolder && (
                <button className="settings-action settings-action-muted" onClick={clearScreenshotFolder}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-name">macOS file access</span>
              <span className="settings-row-desc">
                If agents live under Desktop (or Documents/Downloads), Allow Desktop once in System Settings.
                Prefer the current <code>mosaic.app</code> — not <code>mosaic.app.old</code> — and enable Full Disk Access if prompts keep returning after rebuilds.
              </span>
            </div>
            <button className="settings-action" onClick={() => void openPrivacySettings()}>
              Open Settings
            </button>
          </div>
        </div>

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
          {theme === "aero" && (
            <div className="wallpaper-options">
              {AERO_WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  className={`wallpaper-option ${wallpaper === w.id ? "wallpaper-option-active" : ""}`}
                  onClick={() => setWallpaper(w.id)}
                  aria-pressed={wallpaper === w.id}
                  title={w.name}
                >
                  <span className="wallpaper-thumb" style={{ backgroundImage: `url(/textures/aero/${w.id}-thumb.webp)` }} />
                  <span className="wallpaper-name">{w.name}</span>
                </button>
              ))}
            </div>
          )}
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
