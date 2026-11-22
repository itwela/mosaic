import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import FirstRun from "./components/FirstRun";
import GlassGround from "./components/GlassGround";
import "./components/Boot.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme } from "./lib/theme";
import { hasCurrentSetup, SETUP_RECEIPT_KEY, SetupReceipt } from "./lib/setupIdentity";

applyTheme();

if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  (await import("./dev/preview")).installPreview();
}

// Avoid StrictMode double mounts: each Terminal mount starts a real PTY.
function MosaicRoot() {
  const params = new URLSearchParams(location.search);
  const preview = import.meta.env.DEV && !isTauri();
  const forceSetup = preview && params.has("setup");
  const previewStartup = preview && params.has("startup");
  const previewBoot = import.meta.env.DEV && params.has("boot"); // dev: hold the loading screen
  const [checking, setChecking] = useState(!preview || previewStartup || previewBoot);
  const [setup, setSetup] = useState(forceSetup);
  const [entered, setEntered] = useState(preview && !forceSetup && !previewStartup);
  const [identity, setIdentity] = useState("");
  const [error, setError] = useState("");
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    if (previewBoot || (preview && !previewStartup)) return;
    let active = true;
    void invoke<string>("setup_identity").then(current => {
      if (!current) throw new Error("App identity was empty.");
      if (!active) return;
      const stored = previewStartup
        ? params.get("startup") === "current" ? JSON.stringify({ identity: current, disposition: "completed" }) : params.get("startup") === "legacy" ? null : localStorage.getItem(SETUP_RECEIPT_KEY)
        : localStorage.getItem(SETUP_RECEIPT_KEY);
      const ready = hasCurrentSetup(current, stored);
      setIdentity(current);
      setRechecking(!ready && !!localStorage.getItem("mosaic-setup-dismissed"));
      setSetup(!ready);
      setEntered(ready);
      setChecking(false);
    }).catch(e => { if (active) { setError(String(e)); setChecking(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const show = () => setSetup(true);
    window.addEventListener("mosaic-open-setup", show);
    return () => window.removeEventListener("mosaic-open-setup", show);
  }, []);

  function finish(skipped: boolean) {
    if (identity) {
      const receipt: SetupReceipt = { identity, disposition: skipped ? "skipped" : "completed" };
      localStorage.setItem(SETUP_RECEIPT_KEY, JSON.stringify(receipt));
    }
    localStorage.setItem("mosaic-setup-dismissed", "1");
    setEntered(true); setSetup(false);
  }

  if (checking || error) return <div className="boot" role="status" aria-live="polite">
    <GlassGround origin="center" />
    <div className="boot-mark">
      <img className="boot-icon" src="/textures/glass-art/icon.png" alt="" />
      <div className="boot-word">mosaic</div>
      {error
        ? <><p className="boot-error">Mosaic could not check setup. {error}</p><button className="boot-retry" onClick={() => location.reload()}>Try again</button></>
        : <div className="boot-line" aria-label="Opening Mosaic"><span /></div>}
    </div>
  </div>;

  return <>
    {entered && <div style={{ display: setup ? "none" : "contents" }}><App /></div>}
    {setup && <FirstRun rechecking={rechecking} onDone={finish} />}
  </>;
}
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<MosaicRoot />);
