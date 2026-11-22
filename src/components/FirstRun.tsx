import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import GlassGround from "./GlassGround";
import "./FirstRun.css";

const steps = [
  ["Desktop, Documents and Downloads", "Required", "Your projects and agents live in these folders. macOS shows a prompt for each folder that needs access.", "Allow all three", "amber"],
  ["Full Disk Access", "Recommended", "Turn on the current mosaic.app in System Settings, then quit and reopen Mosaic if macOS asks. Access is checked when you return.", "Open System Settings", "ruby"],
  ["Screenshot folder", "Required", "Mosaic watches one folder for new screenshots and shows them in the top bar.", "Choose folder", "cobalt"],
  ["Launch at login", "Optional", "Open Mosaic when you log in, with your terminals where you left them.", "Turn on", "violet"],
  ["Claude Code status hooks", "Recommended", "Lets Claude Code tell Mosaic when it is working, done or waiting on you. Adds hooks to ~/.claude/settings.json, backed up first.", "Install hooks", "ember"],
  ["Codex notifications", "Recommended", "Lets Mosaic see when Codex needs your approval. Enables notifications in ~/.codex/config.toml, backed up first.", "Turn on", "teal"],
  ["Microphone", "Voice", "Hold fn anywhere to talk and Mosaic types it for you. Audio is turned into text on this Mac and never saved.", "Allow", "rose"],
  ["Voice key", "Voice", "Lets Mosaic hear the fn key in every app and paste your words where you are typing. Turn on mosaic-voice in Accessibility.", "Open System Settings", "amber"],
  ["Meeting audio", "Voice", "When a call starts, Mosaic can take notes. This lets it hear the other people too, not just you.", "Allow", "sea"],
];
const VOICE = [6, 7, 8] as const;
const VOICE_KIND = ["microphone", "accessibility", "systemAudio"];
export default function FirstRun({ onDone, embedded = false, rechecking = false }: { onDone: (skipped: boolean) => void; embedded?: boolean; rechecking?: boolean }) {
  const fixture = import.meta.env.DEV && (window as Window & { __MOSAIC_PREVIEW__?: boolean }).__MOSAIC_PREVIEW__ ? new URLSearchParams(location.search).get("setup") : null;
  const [done, setDone] = useState<boolean[]>([fixture === "done" || fixture === "progress", false, !!localStorage.getItem("mosaic-screenshot-folder"), false, false, false, false, false, false]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const foldersRequested = useRef(false);
  const [diskWaiting, setDiskWaiting] = useState(false);
  const [keyWaiting, setKeyWaiting] = useState(false);
  const [micWaiting, setMicWaiting] = useState(false);
  const [error, setError] = useState("");
  const count = done.filter(Boolean).length;
  const requiredReady = done[0] && done[2];
  function mark(i: number, yes = true) { setDone(v => v.map((x, n) => n === i ? yes : x)); }
  useEffect(() => {
    let active = true;
    void Promise.allSettled([invoke<boolean>("setup_disk_access"), isEnabled(), invoke<boolean>("agent_hooks_installed"), invoke<boolean>("setup_codex_enabled")]).then(results => {
      if (!active) return;
      [1, 3, 4, 5].forEach((step, i) => { const r = results[i]; if (r.status === "fulfilled") mark(step, r.value === true); });
    });
    VOICE.forEach((step, i) => { invoke<boolean>("voice_permission", { kind: VOICE_KIND[i], request: false }).then(ok => { if (active) mark(step, ok); }, () => {}); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const recheck = async () => {
      if (lock.current) return;
      const disk = await invoke<boolean>("setup_disk_access").catch(() => false);
      if (!active) return;
      mark(1, disk);
      const key = await invoke<boolean>("voice_permission", { kind: "accessibility", request: false }).catch(() => false);
      if (active) mark(7, key);
      const mic = await invoke<boolean>("voice_permission", { kind: "microphone", request: false }).catch(() => false);
      if (active) mark(6, mic);
      if (foldersRequested.current) {
        const folders = await invoke("setup_folders").then(() => true, () => false);
        if (active) mark(0, folders);
      }
    };
    window.addEventListener("focus", recheck);
    return () => { active = false; window.removeEventListener("focus", recheck); };
  }, []);
  async function perform(i: number): Promise<boolean> {
    switch (i) {
      case 0:
        foldersRequested.current = true;
        mark(0, false);
        await invoke("setup_folders");
        break;
      case 1:
        if (await invoke<boolean>("setup_disk_access")) break;
        await invoke("setup_open_disk_settings"); setDiskWaiting(true); return false;
      case 2: {
        const path = await open({ directory: true, multiple: false, title: "Choose screenshot folder" });
        if (typeof path !== "string") return false;
        localStorage.setItem("mosaic-screenshot-folder", path);
        window.dispatchEvent(new Event("mosaic-screenshot-folder")); break;
      }
      case 3: await enable(); if (!await isEnabled()) throw new Error("Launch at login is not enabled yet."); break;
      case 4: await invoke("install_agent_hooks"); if (!await invoke<boolean>("agent_hooks_installed")) throw new Error("Hooks could not be verified."); break;
      case 5: await invoke("setup_enable_codex"); if (!await invoke<boolean>("setup_codex_enabled")) throw new Error("Codex notifications could not be verified."); break;
      // If macOS can't show its prompt here, the helper opens the Microphone settings page instead.
      case 6: if (!await invoke<boolean>("voice_permission", { kind: "microphone", request: true })) { setMicWaiting(true); return false; } break;
      case 7: if (!await invoke<boolean>("voice_permission", { kind: "accessibility", request: true })) { setKeyWaiting(true); return false; } break;
      case 8: if (!await invoke<boolean>("voice_permission", { kind: "systemAudio", request: true })) throw new Error("Meeting audio could not be turned on."); break;
    }
    mark(i); return true;
  }
  async function run(index?: number) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      for (const i of index === undefined ? steps.map((_, i) => i).filter(i => !done[i]) : [index]) {
        // Full Disk Access is manual; continue other steps while it is pending.
        const ok = await perform(i);
        if (!ok && i !== 1 && i !== 6 && i !== 7) break;
      }
    } catch (e) { setError(String(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className={`first-run${embedded ? " first-run-embedded" : ""}`}>
    {!embedded && <GlassGround />}
    <section data-glass-light={`none ${.25 + count * .12} 180`} className="setup-sheet" aria-label="Set up Mosaic">
      <div className="setup-brand"><img src="/textures/glass-art/icon.png" alt="" />mosaic</div>
      <h1>{rechecking ? "Check file access" : "Set up Mosaic"}</h1>
      {rechecking && <p className="setup-signing-note">macOS needs file access confirmed for this update. Your terminals will reopen afterward.</p>}
      <p className="setup-intro">{count === steps.length ? "Everything is set. Open Mosaic when you are ready." : diskWaiting && !done[1] ? "Full Disk Access is open in System Settings. Turn on mosaic.app there and come back." : "Mosaic checks each step before marking it complete. macOS controls file permissions and may ask for each folder."}</p>
      <div className="setup-progress" aria-label={`${count} of ${steps.length} complete`}><span>{count} of {steps.length}</span><div>{steps.map((s, i) => <i key={i} data-glass={s[4]} className={done[i] ? "lit" : ""} />)}</div></div>
      <div className="setup-steps">{steps.map(([title, need, desc, action, glass], i) => <div key={title} className={`setup-step${done[i] ? " complete" : ""}${(i === 1 && diskWaiting || i === 6 && micWaiting || i === 7 && keyWaiting) && !done[i] ? " waiting" : ""}`}>
        <span className="setup-chip" data-glass={glass}>{done[i] ? "✓" : ""}</span>
        <div className="setup-copy"><div className="setup-step-title">{title}<small>{need}</small></div><p>{desc}</p></div>
        <div className="setup-action">{done[i] ? <span className="setup-allowed">{["All three folders", "Access verified", "Folder chosen", "On", "Installed", "On", "On", "On", "On"][i]}<small>Allowed</small></span> : <button disabled={busy} onClick={() => void run(i)}><span className="setup-desktop-action">{busy ? "Working…" : (i === 1 && diskWaiting) || (i === 6 && micWaiting) || (i === 7 && keyWaiting) ? "Check again" : action}</span><span className="setup-compact-action">{busy ? "Wait…" : i === 1 && diskWaiting ? "Check" : "Allow"}</span></button>}</div>
      </div>)}</div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <footer className="setup-footer">{count < steps.length && <button disabled={busy} onClick={() => onDone(true)}>Skip for now</button>}<span>You can change any of these later in Settings.</span><button className="setup-primary" disabled={busy} onClick={() => requiredReady ? onDone(false) : void run()}>{busy ? "Setting up…" : requiredReady ? "Open Mosaic" : count ? `Continue, ${steps.length - count} left` : "Grant everything"}</button></footer>
    </section>
  </div>;
}
