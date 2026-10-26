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
    json["hooks"]
        .as_object()
        .map(|hooks| hooks.values().any(|groups| groups.as_array().is_some_and(|g| g.iter().any(is_mosaic_group))))
        .unwrap_or(false)
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

fn claude_usage() -> Result<serde_json::Value, String> {
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
        return Err(usage["error"]["message"].as_str().unwrap_or("Claude usage request failed. Run `claude` once to refresh the login.").to_string());
    }
    usage["plan"] = oauth["subscriptionType"].clone();
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

// Codex records its rate-limit windows into each session log, so the newest
// log has the latest numbers without any network call or extra login.
fn codex_usage() -> Result<serde_json::Value, String> {
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
fn antigravity_usage() -> Result<serde_json::Value, String> {
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
