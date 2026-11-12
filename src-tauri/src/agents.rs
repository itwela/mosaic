use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

// Agent state reported by the agents themselves. Screen-scraping a TUI can't
// tell "waiting for approval" from "finished" reliably, but Claude Code hooks
// fire on exactly those events. Every Mosaic shell gets MOSAIC_TAB_ID, and the
// hook script writes the agent's state to ~/.mosaic/agent-state/<tab id>.

const HOOK_MARKER: &str = "mosaic-agent-state";

const HOOK_SCRIPT: &str = r#"#!/bin/sh
# Installed by Mosaic. Records Claude Code's state for the Mosaic tab it runs in.
cat >/dev/null 2>&1
[ -n "$MOSAIC_TAB_ID" ] || exit 0
dir="$HOME/.mosaic/agent-state"
mkdir -p "$dir"
printf '%s' "$1" > "$dir/$MOSAIC_TAB_ID"
exit 0
"#;

// Claude Code hands its status line the account's rate limits after every
// response, with no extra network call. Mosaic's status line saves that JSON so
// the usage panel never has to poll Anthropic's (heavily rate-limited) endpoint.
const STATUSLINE_MARKER: &str = "mosaic-statusline";

const STATUSLINE_SCRIPT: &str = r#"#!/bin/sh
# Installed by Mosaic. Saves Claude Code's status-line JSON (rate limits) for the usage panel.
dir="$HOME/.mosaic"
mkdir -p "$dir"
cat > "$dir/claude-statusline.json.tmp" && mv "$dir/claude-statusline.json.tmp" "$dir/claude-statusline.json"
exit 0
"#;

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "no home directory".to_string())
}

fn state_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".mosaic").join("agent-state"))
}

fn script_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".mosaic").join("bin").join(HOOK_MARKER))
}

// (state, written-at in ms since the epoch)
pub fn read_hook_state(id: &str) -> Option<(String, u64)> {
    let path = state_dir()?.join(id);
    let state = std::fs::read_to_string(&path).ok()?;
    let at = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((state.trim().to_string(), at))
}

pub fn clear_hook_state(id: &str) {
    if let Some(dir) = state_dir() {
        let _ = std::fs::remove_file(dir.join(id));
    }
}

fn claude_settings_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".claude").join("settings.json"))
}

fn is_mosaic_group(group: &serde_json::Value) -> bool {
    group["hooks"]
        .as_array()
        .map(|hooks| hooks.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains(HOOK_MARKER))))
        .unwrap_or(false)
}

#[tauri::command]
pub fn agent_hooks_installed() -> bool {
    let Ok(path) = claude_settings_path() else { return false };
    let Ok(raw) = std::fs::read_to_string(path) else { return false };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else { return false };
    let hooks = json["hooks"]
        .as_object()
        .map(|hooks| hooks.values().any(|groups| groups.as_array().is_some_and(|g| g.iter().any(is_mosaic_group))))
        .unwrap_or(false);
    // Older installs predate the status-line usage feed; report them as not installed
    // so Settings offers the button again. A user's own status line counts as set.
    hooks && json.get("statusLine").is_some()
}

#[tauri::command]
pub fn install_agent_hooks() -> Result<(), String> {
    let script = script_path()?;
    std::fs::create_dir_all(script.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&script, HOOK_SCRIPT).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }

    let settings_path = claude_settings_path()?;
    let mut settings: serde_json::Value = match std::fs::read_to_string(&settings_path) {
        Ok(raw) => {
            // Keep a copy before the first edit; never overwrite the user's own backup.
            let backup = settings_path.with_extension("json.mosaic-backup");
            if !backup.exists() {
                let _ = std::fs::write(&backup, &raw);
            }
            serde_json::from_str(&raw).map_err(|e| format!("~/.claude/settings.json is not valid JSON: {e}"))?
        }
        Err(_) => serde_json::json!({}),
    };

    let cmd = |state: &str| format!("\"{}\" {}", script.display(), state);
    let group = |matcher: Option<&str>, state: &str| {
        let mut g = serde_json::json!({ "hooks": [{ "type": "command", "command": cmd(state) }] });
        if let Some(m) = matcher {
            g["matcher"] = serde_json::json!(m);
        }
        g
    };
    let wanted: Vec<(&str, serde_json::Value)> = vec![
        ("UserPromptSubmit", group(None, "running")),
        ("PreToolUse", group(None, "running")),
        ("PostToolUse", group(None, "running")),
        ("Notification", group(Some("permission_prompt"), "attention")),
        ("Notification", group(Some("elicitation_dialog"), "attention")),
        ("Notification", group(Some("idle_prompt"), "ready")),
        ("Stop", group(None, "ready")),
        ("SessionStart", group(None, "ready")),
        ("SessionEnd", group(None, "ended")),
    ];

    if !settings["hooks"].is_object() {
        settings["hooks"] = serde_json::json!({});
    }
    // Feed the usage panel from the status line, but never replace one the user set up.
    let statusline = home()?.join(".mosaic").join("bin").join(STATUSLINE_MARKER);
    std::fs::write(&statusline, STATUSLINE_SCRIPT).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&statusline, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let ours = settings["statusLine"]["command"].as_str().is_some_and(|c| c.contains(STATUSLINE_MARKER));
    if settings.get("statusLine").is_none() || ours {
        settings["statusLine"] = serde_json::json!({ "type": "command", "command": format!("\"{}\"", statusline.display()) });
    }

    let hooks = settings["hooks"].as_object_mut().unwrap();
    // Drop any earlier Mosaic entries so reinstalling never duplicates them.
    for groups in hooks.values_mut() {
        if let Some(arr) = groups.as_array_mut() {
            arr.retain(|g| !is_mosaic_group(g));
        }
    }
    for (event, g) in wanted {
        let entry = hooks.entry(event.to_string()).or_insert_with(|| serde_json::json!([]));
        if let Some(arr) = entry.as_array_mut() {
            arr.push(g);
        }
    }

    std::fs::create_dir_all(settings_path.parent().unwrap()).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, text + "\n").map_err(|e| e.to_string())
}

// ── Usage ────────────────────────────────────────────────────────────────────

fn curl_json(url: &str, headers: &[String]) -> Result<serde_json::Value, String> {
    curl_with(url, headers, None, &[])
}

fn curl_with(url: &str, headers: &[String], body: Option<&str>, extra: &[&str]) -> Result<serde_json::Value, String> {
    // Headers go through stdin so tokens never show up in `ps`.
    let mut args = vec!["-sS", "--max-time", "12", "-H", "@-"];
    args.extend_from_slice(extra);
    if let Some(b) = body {
        args.extend_from_slice(&["-d", b]);
    }
    args.push(url);
    let mut child = Command::new("curl")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child.stdin.take().unwrap().write_all(headers.join("\n").as_bytes()).map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|_| "unexpected response".to_string())
}

fn mosaic_dir() -> Result<PathBuf, String> {
    Ok(home()?.join(".mosaic"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mtime_secs(path: &std::path::Path) -> Option<u64> {
    std::fs::metadata(path).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

// Anthropic's usage endpoint answers 429 if it's asked too often, so ask at most
// every 15 minutes and keep the last good answer on disk for everything else.
const CLAUDE_ENDPOINT_EVERY_SECS: u64 = 15 * 60;

fn claude_endpoint() -> Result<serde_json::Value, String> {
    let cache = mosaic_dir()?.join("cache").join("claude-usage.json");
    let attempt = mosaic_dir()?.join("cache").join("claude-usage.attempt");
    let cached = || -> Option<serde_json::Value> { serde_json::from_str(&std::fs::read_to_string(&cache).ok()?).ok() };
    let last_try = mtime_secs(&attempt).unwrap_or(0);
    if now_secs().saturating_sub(last_try) < CLAUDE_ENDPOINT_EVERY_SECS {
        return cached().ok_or_else(|| "waiting to retry Anthropic's usage endpoint".into());
    }
    let _ = std::fs::create_dir_all(cache.parent().unwrap());
    let _ = std::fs::write(&attempt, b"");

    let fetch = || -> Result<serde_json::Value, String> {
        let out = Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err("Not signed in. Run `claude` and log in with your Claude account.".into());
        }
        let creds: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|_| "unreadable Claude credentials".to_string())?;
        let oauth = &creds["claudeAiOauth"];
        let token = oauth["accessToken"].as_str().ok_or("Claude credentials have no access token")?;
        let mut usage = curl_json(
            "https://api.anthropic.com/api/oauth/usage",
            &[format!("Authorization: Bearer {token}"), "anthropic-beta: oauth-2025-04-20".into()],
        )?;
        if usage.get("error").is_some() {
            return Err(usage["error"]["message"].as_str().unwrap_or("Claude usage request failed").to_string());
        }
        usage["plan"] = oauth["subscriptionType"].clone();
        usage["observed_at"] = serde_json::json!(now_secs());
        Ok(usage)
    };
    match fetch() {
        Ok(v) => {
            let _ = std::fs::write(&cache, v.to_string());
            Ok(v)
        }
        Err(e) => cached().ok_or(e),
    }
}

// Status-line windows are { used_percentage, resets_at (epoch s) }; the endpoint's
// are { utilization, resets_at (ISO) }. Normalize to the endpoint's shape.
fn claude_usage() -> Result<serde_json::Value, String> {
    let line_path = mosaic_dir()?.join("claude-statusline.json");
    let line: Option<serde_json::Value> = std::fs::read_to_string(&line_path).ok().and_then(|r| serde_json::from_str(&r).ok());
    let line_at = mtime_secs(&line_path).unwrap_or(0);
    let endpoint = claude_endpoint();

    let mut usage = match &endpoint {
        Ok(v) => v.clone(),
        Err(_) => serde_json::json!({}),
    };
    let endpoint_at = usage["observed_at"].as_u64().unwrap_or(0);
    let limits = line.as_ref().map(|l| l["rate_limits"].clone()).filter(|l| l.is_object());
    if let Some(limits) = limits.filter(|_| line_at >= endpoint_at) {
        for key in ["five_hour", "seven_day"] {
            let w = &limits[key];
            if let Some(pct) = w["used_percentage"].as_f64() {
                usage[key] = serde_json::json!({ "utilization": pct, "resets_at_epoch": w["resets_at"].clone() });
            }
        }
        usage["observed_at"] = serde_json::json!(line_at);
        usage["source"] = serde_json::json!("statusline");
    } else if endpoint.is_ok() {
        usage["source"] = serde_json::json!("endpoint");
    }
    if usage.get("source").is_none() {
        return Err(match endpoint {
            Err(e) if e.contains("Not signed in") => e,
            _ => "No Claude usage yet. Turn on agent tracking in Settings, then send Claude Code a message.".into(),
        });
    }
    Ok(usage)
}

fn newest_jsonl(dir: &std::path::Path, best: &mut Option<(std::time::SystemTime, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            newest_jsonl(&path, best);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                if best.as_ref().is_none_or(|(t, _)| modified > *t) {
                    *best = Some((modified, path));
                }
            }
        }
    }
}

// ChatGPT's usage endpoint is the only place that reports rate-limit reset
// credits. The CLI's own login (~/.codex/auth.json) authorizes it.
fn codex_live() -> Result<serde_json::Value, String> {
    let auth: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(home()?.join(".codex").join("auth.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let token = auth["tokens"]["access_token"].as_str().ok_or("no Codex token")?;
    let mut headers = vec![format!("Authorization: Bearer {token}")];
    if let Some(acc) = auth["tokens"]["account_id"].as_str() {
        headers.push(format!("ChatGPT-Account-Id: {acc}"));
    }
    let v = curl_json("https://chatgpt.com/backend-api/wham/usage", &headers)?;
    let rl = &v["rate_limit"];
    if !rl.is_object() {
        return Err("unexpected Codex usage response".into());
    }
    let win = |w: &serde_json::Value| {
        w.is_object().then(|| serde_json::json!({
            "used_percent": w["used_percent"],
            "window_minutes": w["limit_window_seconds"].as_u64().map(|s| s / 60),
            "resets_at": w["reset_at"],
        }))
    };
    Ok(serde_json::json!({
        "primary": win(&rl["primary_window"]),
        "secondary": win(&rl["secondary_window"]),
        "plan_type": v["plan_type"],
        "reset_credits": v["rate_limit_reset_credits"],
        "observed_at": now_secs(),
        "live": true,
    }))
}

fn codex_usage() -> Result<serde_json::Value, String> {
    codex_live().or_else(|_| codex_log_usage())
}

// Codex records its rate-limit windows into each session log, so the newest
// log has the latest numbers without any network call or extra login.
fn codex_log_usage() -> Result<serde_json::Value, String> {
    let sessions = home()?.join(".codex").join("sessions");
    let mut best = None;
    newest_jsonl(&sessions, &mut best);
    let (modified, path) = best.ok_or("No Codex sessions yet. Run `codex` once.")?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    for line in text.lines().rev() {
        if !line.contains("\"rate_limits\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let limits = v.pointer("/payload/rate_limits").or_else(|| v.get("rate_limits"));
        if let Some(limits) = limits.filter(|l| l.is_object()) {
            let mut limits = limits.clone();
            limits["observed_at"] = serde_json::json!(modified.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
            return Ok(limits);
        }
    }
    Err("The latest Codex session has no rate-limit data yet. Send Codex a message.".into())
}

// Cursor keeps its login in the editor's VS Code state database.
fn cursor_usage() -> Result<serde_json::Value, String> {
    let db = home()?.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    if !db.exists() {
        return Err("Cursor isn't installed or signed in.".into());
    }
    let out = Command::new("sqlite3")
        .arg(&db)
        .arg("select value from ItemTable where key='cursorAuth/accessToken'")
        .output()
        .map_err(|e| e.to_string())?;
    let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if token.is_empty() {
        return Err("Not signed in. Open Cursor and log in.".into());
    }
    let usage = curl_with(
        "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
        &[format!("Authorization: Bearer {token}"), "Content-Type: application/json".into(), "Connect-Protocol-Version: 1".into()],
        Some("{}"),
        &[],
    )?;
    if usage.get("code").is_some() {
        return Err("Cursor rejected the saved login. Open Cursor to refresh it.".into());
    }
    Ok(usage)
}

// Antigravity serves its quota from a local language server that only runs
// while the app is open. Its port and CSRF token are on the process's argv.
// The agy CLI prints the same quota summary Antigravity's UI shows (every group,
// including Argon's separate weekly bucket) using its own login, app closed or not.
fn antigravity_cli() -> Result<serde_json::Value, String> {
    let home = home()?;
    let bin = [home.join(".local/bin/agy"), PathBuf::from("/opt/homebrew/bin/agy"), PathBuf::from("/usr/local/bin/agy")]
        .into_iter()
        .find(|p| p.exists())
        .ok_or("agy not installed")?;
    let cwd = mosaic_dir()?;
    let _ = std::fs::create_dir_all(&cwd);
    let out = Command::new(bin)
        .args(["-p", "/usage", "--output-format", "json", "--print-timeout", "60s"])
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.find('{').ok_or("agy printed no JSON")?;
    let v: serde_json::Value = serde_json::from_str(text[start..].trim()).map_err(|_| "unreadable agy output".to_string())?;
    if v["status"] != "SUCCESS" || !v["command"]["data"]["groups"].is_array() {
        return Err("agy couldn't read usage. Run `agy` once and sign in.".into());
    }
    Ok(serde_json::json!({ "summary": v["command"]["data"], "source": "cli" }))
}

fn antigravity_usage() -> Result<serde_json::Value, String> {
    if let Ok(v) = antigravity_cli() {
        return Ok(v);
    }
    if antigravity_saved().is_some() {
        if let Ok(v) = antigravity_cloud() {
            return Ok(v);
        }
    }
    antigravity_local().map_err(|e| if antigravity_saved().is_none() { "needs-login".to_string() } else { e })
}

fn antigravity_local() -> Result<serde_json::Value, String> {
    let ps = Command::new("ps").args(["-axo", "pid=,command="]).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&ps.stdout);
    let line = text
        .lines()
        .find(|l| l.contains("language_server_macos") && l.contains("--csrf_token"))
        .ok_or("Open Antigravity to see its quota (it reports usage only while running).")?;
    let pid = line.split_whitespace().next().unwrap_or("").to_string();
    let csrf = line
        .split_whitespace()
        .skip_while(|a| *a != "--csrf_token")
        .nth(1)
        .ok_or("Antigravity's language server has no CSRF token")?
        .to_string();
    let lsof = Command::new("lsof")
        .args(["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", &pid])
        .output()
        .map_err(|e| e.to_string())?;
    let ports: Vec<String> = String::from_utf8_lossy(&lsof.stdout)
        .lines()
        .skip(1)
        .filter_map(|l| l.split_whitespace().nth(8)?.rsplit(':').next().map(str::to_string))
        .collect();
    let headers = [format!("X-Codeium-Csrf-Token: {csrf}"), "Content-Type: application/json".into(), "Connect-Protocol-Version: 1".into()];
    let body = r#"{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}"#;
    for port in ports {
        let url = format!("https://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus");
        // Self-signed localhost certificate.
        if let Ok(v) = curl_with(&url, &headers, Some(body), &["-k", "--max-time", "4"]) {
            if let Some(status) = v.get("userStatus") {
                return Ok(status.clone());
            }
        }
    }
    Err("Couldn't reach Antigravity's language server.".into())
}

// ── Antigravity cloud mode ───────────────────────────────────────────────────
// With Antigravity closed, the same quota comes from Google's Cloud Code API.
// Mosaic reads the OAuth client credentials from environment or ~/.mosaic/antigravity.json
// and keeps the refresh token locally.

fn ag_client_creds(saved: Option<&serde_json::Value>) -> Result<(String, String), String> {
    let id = std::env::var("MOSAIC_AG_CLIENT_ID")
        .ok()
        .or_else(|| saved.and_then(|v| v["client_id"].as_str().map(str::to_string)))
        .or_else(|| saved_key("antigravity_client_id"))
        .ok_or("Antigravity OAuth client_id not configured")?;
    let secret = std::env::var("MOSAIC_AG_CLIENT_SECRET")
        .ok()
        .or_else(|| saved.and_then(|v| v["client_secret"].as_str().map(str::to_string)))
        .or_else(|| saved_key("antigravity_client_secret"))
        .ok_or("Antigravity OAuth client_secret not configured")?;
    Ok((id, secret))
}
const AG_SCOPES: &str = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email";
const AG_API: &str = "https://cloudcode-pa.googleapis.com/v1internal";
const AG_META: &str = r#"{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}"#;

fn ag_path() -> Result<PathBuf, String> {
    Ok(mosaic_dir()?.join("antigravity.json"))
}

fn antigravity_saved() -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(ag_path().ok()?).ok()?).ok()?;
    v["refresh_token"].is_string().then_some(v)
}

fn ag_save(v: &serde_json::Value) -> Result<(), String> {
    let path = ag_path()?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(v).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    let enc = |s: &str| {
        s.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                _ => format!("%{b:02X}"),
            })
            .collect::<String>()
    };
    pairs.iter().map(|(k, v)| format!("{}={}", enc(k), enc(v))).collect::<Vec<_>>().join("&")
}

fn google_token(pairs: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let v = curl_with(
        "https://oauth2.googleapis.com/token",
        &["Content-Type: application/x-www-form-urlencoded".into()],
        Some(&form_encode(pairs)),
        &[],
    )?;
    if v.get("error").is_some() {
        return Err(format!("Google sign-in failed: {}", v["error_description"].as_str().or(v["error"].as_str()).unwrap_or("unknown")));
    }
    Ok(v)
}

fn ag_post(token: &str, method: &str, body: &str) -> Result<serde_json::Value, String> {
        ag_post_at(AG_API, token, method, body)
}

fn ag_post_at(base: &str, token: &str, method: &str, body: &str) -> Result<serde_json::Value, String> {
    let v = curl_with(
        &format!("{base}:{method}"),
        &[format!("Authorization: Bearer {token}"), "Content-Type: application/json".into(), "User-Agent: antigravity".into()],
        Some(body),
        &[],
    )?;
    if let Some(e) = v.get("error") {
        return Err(e["message"].as_str().unwrap_or("Cloud Code request failed").to_string());
    }
    Ok(v)
}

fn antigravity_cloud() -> Result<serde_json::Value, String> {
    let mut saved = antigravity_saved().ok_or("needs-login")?;
    let (client_id, client_secret) = ag_client_creds(Some(&saved)).map_err(|_| "needs-login")?;
    let refresh = saved["refresh_token"].as_str().unwrap_or_default().to_string();
    let tok = google_token(&[
        ("client_id", &client_id),
        ("client_secret", &client_secret),
        ("refresh_token", &refresh),
        ("grant_type", "refresh_token"),
    ])
    .map_err(|e| format!("{e}. Sign in to Antigravity again."))?;
    let access = tok["access_token"].as_str().ok_or("Google returned no access token")?;

    let assist = ag_post(access, "loadCodeAssist", &format!(r#"{{"metadata":{AG_META}}}"#))?;
    let project = assist["cloudaicompanionProject"]
        .as_str()
        .map(str::to_string)
        .or_else(|| assist["cloudaicompanionProject"]["id"].as_str().map(str::to_string))
        .or_else(|| saved["project_id"].as_str().map(str::to_string));
    if let Some(p) = &project {
        if saved["project_id"].as_str() != Some(p) {
            saved["project_id"] = serde_json::json!(p);
            let _ = ag_save(&saved);
        }
    }
    let body = project.map(|p| serde_json::json!({ "project": p }).to_string()).unwrap_or_else(|| "{}".into());
    // The quota summary is what Antigravity's own UI shows: per-family 5-hour and
    // weekly buckets (CodexBar reads the same). Per-model quotas are the fallback.
    if let Ok(summary) = ag_post_at("https://daily-cloudcode-pa.googleapis.com/v1internal", access, "retrieveUserQuotaSummary", &body) {
        if let Ok(dir) = mosaic_dir() {
            let _ = std::fs::write(dir.join("cache").join("antigravity-summary.json"), serde_json::to_string_pretty(&summary).unwrap_or_default());
        }
        let payload = summary.get("response").or(summary.get("summary")).unwrap_or(&summary);
        if payload["groups"].as_array().is_some_and(|g| !g.is_empty()) {
            return Ok(serde_json::json!({
                "summary": payload,
                "planStatus": { "planInfo": { "planName": assist["currentTier"]["name"] } },
                "source": "cloud",
            }));
        }
    }
    let models = ag_post(access, "fetchAvailableModels", &body)?;

    // Same shape the local language server returns, so the panel reads both alike.
    let configs: Vec<serde_json::Value> = models["models"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(_, v)| v["quotaInfo"].is_object())
                .map(|(id, v)| {
                    // Some models (e.g. Gemini Argon) come without a display name; derive one from the ID.
                    let pretty = || {
                        id.split(['-', '_'])
                            .filter(|w| !w.is_empty())
                            .map(|w| {
                                let mut c = w.chars();
                                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
                            })
                            .collect::<Vec<_>>()
                            .join(" ")
                    };
                    let name = v["displayName"].as_str().or(v["label"].as_str()).filter(|n| !n.trim().is_empty() && !n.eq_ignore_ascii_case("model")).map(str::to_string).unwrap_or_else(pretty);
                    serde_json::json!({ "label": name, "quotaInfo": v["quotaInfo"] })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "cascadeModelConfigData": { "clientModelConfigs": configs },
        "planStatus": { "planInfo": { "planName": assist["currentTier"]["name"] } },
        "source": "cloud",
    }))
}

#[tauri::command]
pub async fn antigravity_login() -> Result<(), String> {
    tokio::task::spawn_blocking(|| -> Result<(), String> {
        use std::io::{BufRead, BufReader};
        let existing = ag_path().ok().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
        let (client_id, client_secret) = ag_client_creds(existing.as_ref())?;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let redirect = format!("http://127.0.0.1:{port}/oauth-callback");
        let state = format!("{:x}", now_secs() ^ (std::process::id() as u64) << 20);
        let url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?{}",
            form_encode(&[
                ("client_id", &client_id),
                ("redirect_uri", &redirect),
                ("response_type", "code"),
                ("scope", AG_SCOPES),
                ("access_type", "offline"),
                ("prompt", "consent"),
                ("state", &state),
            ])
        );
        Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;

        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        let mut stream = loop {
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() > deadline {
                        return Err("Sign-in timed out.".into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(e) => return Err(e.to_string()),
            }
        };
        stream.set_nonblocking(false).map_err(|e| e.to_string())?;
        let mut request_line = String::new();
        BufReader::new(&stream).read_line(&mut request_line).map_err(|e| e.to_string())?;
        let query = request_line.split_whitespace().nth(1).and_then(|p| p.split_once('?')).map(|(_, q)| q.to_string()).unwrap_or_default();
        let param = |name: &str| {
            query.split('&').find_map(|kv| kv.split_once('=').filter(|(k, _)| *k == name).map(|(_, v)| v.replace("%2F", "/").replace("%2f", "/")))
        };
        let ok = param("state").as_deref() == Some(state.as_str()) && param("code").is_some();
        let page = if ok { "Signed in. You can close this tab and go back to Mosaic." } else { "Sign-in failed. Close this tab and try again from Mosaic." };
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n{page}");
        if !ok {
            return Err(param("error").unwrap_or_else(|| "Sign-in was cancelled.".into()));
        }
        let code = param("code").unwrap();
        let tok = google_token(&[
            ("client_id", &client_id),
            ("client_secret", &client_secret),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ])?;
        let refresh = tok["refresh_token"].as_str().ok_or("Google returned no refresh token")?;
        ag_save(&serde_json::json!({ "refresh_token": refresh, "client_id": client_id, "client_secret": client_secret }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn keys_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".mosaic").join("keys.json"))
}

fn saved_key(provider: &str) -> Option<String> {
    let raw = std::fs::read_to_string(keys_path().ok()?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json[provider].as_str().filter(|k| !k.is_empty()).map(str::to_string)
}

#[tauri::command]
pub fn set_provider_key(provider: String, key: String) -> Result<(), String> {
    let path = keys_path()?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut json: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|r| serde_json::from_str(&r).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    json[provider] = serde_json::json!(key.trim());
    std::fs::write(&path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn deepseek_usage() -> Result<serde_json::Value, String> {
    let key = saved_key("deepseek")
        .or_else(|| std::env::var("DEEPSEEK_API_KEY").ok())
        .ok_or("needs-key")?;
    let v = curl_json("https://api.deepseek.com/user/balance", &[format!("Authorization: Bearer {key}")])?;
    if v.get("error").is_some() {
        return Err("DeepSeek rejected the API key.".into());
    }
    Ok(v)
}

#[tauri::command]
pub async fn provider_usage() -> serde_json::Value {
    let wrap = |r: Result<serde_json::Value, String>| match r {
        Ok(data) => serde_json::json!({ "ok": true, "data": data }),
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    };
    let (claude, codex, cursor, antigravity, deepseek) = tokio::join!(
        tokio::task::spawn_blocking(claude_usage),
        tokio::task::spawn_blocking(codex_usage),
        tokio::task::spawn_blocking(cursor_usage),
        tokio::task::spawn_blocking(antigravity_usage),
        tokio::task::spawn_blocking(deepseek_usage),
    );
    let done = |r: Result<Result<serde_json::Value, String>, tokio::task::JoinError>| wrap(r.unwrap_or_else(|e| Err(e.to_string())));
    serde_json::json!({
        "claude": done(claude),
        "codex": done(codex),
        "cursor": done(cursor),
        "antigravity": done(antigravity),
        "deepseek": done(deepseek),
    })
}

// ── Claude limit resets ──────────────────────────────────────────────────────
// Anthropic only reports limit resets to a claude.ai web session (Claude Code's
// OAuth login gets `ineligible_reason: "surface"`), and claude.ai rejects plain
// HTTP clients. So Mosaic keeps one hidden claude.ai window, signed in once by
// the user, and runs the same fetch the usage page runs inside it. The page
// hands the answer back by navigating to a sentinel URL that Mosaic intercepts
// and cancels, so it never leaves the machine.

const CLAUDE_WEB: &str = "https://claude.ai";
const CLAUDE_WIN: &str = "claude-web";
const RESULT_HOST: &str = "mosaic-result.localhost";

fn web_log(msg: &str) {
    if let Ok(dir) = mosaic_dir() {
        let path = dir.join("cache").join("claude-web.log");
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{} {msg}", now_secs());
        }
    }
}

static RESULT_TX: std::sync::Mutex<Option<std::sync::mpsc::Sender<String>>> = std::sync::Mutex::new(None);

fn claude_window(app: &tauri::AppHandle, path: &str, visible: bool) -> Result<tauri::WebviewWindow, String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window(CLAUDE_WIN) {
        return Ok(w);
    }
    tauri::WebviewWindowBuilder::new(app, CLAUDE_WIN, tauri::WebviewUrl::External(format!("{CLAUDE_WEB}{path}").parse().unwrap()))
        .title("Sign in to Claude")
        .inner_size(480.0, 720.0)
        .visible(visible)
        .on_navigation(|url| {
            web_log(&format!("navigation -> {}{}", url.host_str().unwrap_or(""), url.path()));
            if url.host_str() == Some(RESULT_HOST) {
                let data = url.query_pairs().find(|(k, _)| k == "d").map(|(_, v)| v.into_owned()).unwrap_or_default();
                if let Some(tx) = RESULT_TX.lock().unwrap().as_ref() {
                    let _ = tx.send(data);
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())
}

fn on_claude_app(w: &tauri::WebviewWindow) -> bool {
    w.url().map(|u| u.host_str() == Some("claude.ai") && !u.path().starts_with("/login") && !u.path().starts_with("/magic-link")).unwrap_or(false)
}

fn claude_authed_marker() -> Option<PathBuf> {
    mosaic_dir().ok().map(|dir| dir.join("cache").join("claude-web.authed"))
}

fn mark_claude_authed(authed: bool) {
    let Some(path) = claude_authed_marker() else { return };
    if authed {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, b"1");
    } else {
        let _ = std::fs::remove_file(path);
    }
}

fn is_claude_authed() -> bool {
    claude_authed_marker().map(|p| p.exists()).unwrap_or(false)
}

#[tauri::command]
pub async fn claude_web_login(app: tauri::AppHandle) -> Result<(), String> {
    let w = claude_window(&app, "/login", true)?;
    let _ = w.navigate(format!("{CLAUDE_WEB}/login").parse().unwrap());
    let _ = w.show();
    let _ = w.set_focus();
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        if !w.is_visible().unwrap_or(false) {
            let _ = w.destroy();
            return Err("Sign-in window was closed.".into());
        }
        if on_claude_app(&w) {
            mark_claude_authed(true);
            let _ = w.destroy();
            return Ok(());
        }
        if std::time::Instant::now() > deadline {
            let _ = w.destroy();
            return Err("Sign-in timed out.".into());
        }
    }
}

const RESETS_JS: &str = r#"(async () => {
  const send0 = (o) => { location.href = 'https://__HOST__/?d=' + encodeURIComponent(JSON.stringify(o)); };
  const send = (o) => setTimeout(() => send0(o), 0);
  send0({ stage: 'started' });
  try {
    const r = await fetch('/api/organizations', { credentials: 'include' });
    if (!r.ok) return send({ ok: false, error: 'needs-login' });
    const orgs = await r.json();
    const org = (orgs.find(o => (o.capabilities || []).includes('chat')) || orgs[0] || {}).uuid;
    if (!org) return send({ ok: false, error: 'No claude.ai organization found' });
    const u = await fetch('/api/organizations/' + org + '/usage?cedar_ember=true&skip_spend=true', { credentials: 'include' });
    if (!u.ok) return send({ ok: false, error: u.status === 401 || u.status === 403 ? 'needs-login' : 'claude.ai usage returned ' + u.status });
    const d = await u.json();
    send({ ok: true, data: d.cedar_ember });
  } catch (e) { send({ ok: false, error: String(e) }); }
})();"#;

#[tauri::command]
pub async fn claude_resets(app: tauri::AppHandle) -> serde_json::Value {
    // One fetch at a time: each run owns the result channel, and overlapping
    // panel refreshes were cancelling each other. A fresh result is reused.
    static LOCK: tokio::sync::Mutex<Option<(u64, serde_json::Value)>> = tokio::sync::Mutex::const_new(None);
    let mut last = LOCK.lock().await;
    if let Some((at, v)) = last.as_ref() {
        let ttl = if v["ok"] == true { 900 } else { 120 };
        if now_secs().saturating_sub(*at) < ttl && (v["ok"] == true || is_claude_authed()) {
            return v.clone();
        }
    }
    let v = claude_resets_once(app).await;
    if v["ok"] == true {
        mark_claude_authed(true);
        *last = Some((now_secs(), v.clone()));
    } else if v["error"] == "needs-login" {
        mark_claude_authed(false);
        *last = Some((now_secs(), v.clone()));
    }
    v
}

async fn claude_resets_once(app: tauri::AppHandle) -> serde_json::Value {
    let fail = |e: &str| serde_json::json!({ "ok": false, "error": e });
    // Avoid spawning a 300MB+ hidden WebKit process unless the user has signed in at least once.
    let had_window = { use tauri::Manager; app.get_webview_window(CLAUDE_WIN).is_some() };
    if !had_window && !is_claude_authed() {
        return fail("needs-login");
    }
    let w = match claude_window(&app, "/", false) {
        Ok(w) => w,
        Err(e) => return fail(&e),
    };
    if w.is_visible().unwrap_or(false) {
        return fail("signing-in");
    }
    // Give a freshly created window time to load claude.ai.
    let wait_until = std::time::Instant::now() + std::time::Duration::from_secs(if had_window { 2 } else { 20 });
    while !on_claude_app(&w) {
        if std::time::Instant::now() > wait_until {
            let _ = w.destroy();
            return fail("needs-login");
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    if !had_window {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }

    web_log(&format!("eval on {}", w.url().map(|u| u.to_string().split('?').next().unwrap_or("").to_string()).unwrap_or_default()));
    let (tx, rx) = std::sync::mpsc::channel();
    *RESULT_TX.lock().unwrap() = Some(tx);
    if let Err(e) = w.eval(RESETS_JS.replace("__HOST__", RESULT_HOST)) {
        let _ = w.destroy();
        return fail(&e.to_string());
    }
    let got = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        loop {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            let msg = rx.recv_timeout(left).map_err(|e| e.to_string())?;
            web_log(&format!("message: {}", &msg.chars().take(120).collect::<String>()));
            if !msg.contains("\"stage\"") {
                return Ok(msg);
            }
        }
    })
    .await;
    *RESULT_TX.lock().unwrap() = None;
    // Destroy the hidden claude.ai webview once the fetch completes so its
    // WebContent process doesn't sit in RAM between checks; cookies persist in WKWebsiteDataStore.
    let _ = w.destroy();
    match got {
        Ok(Ok(text)) => serde_json::from_str(&text).unwrap_or_else(|_| fail("unreadable claude.ai response")),
        other => {
            web_log(&format!("timed out: {other:?}"));
            fail("claude.ai didn't answer in time")
        }
    }
}
