//! Mosaic Voice: Wispr-style dictation and meeting notes, all on this computer.
//!
//! - Mac: the `mosaic-voice` helper (Swift, src-tauri/voice) owns the fn key, the mic, Apple's
//!   on-device speech engine, system audio, meeting detection and the bubble. It sends raw text here.
//! - Windows: not built yet (Right Alt + Parakeet + WASAPI); see the TODO in `start`.
//! - Here (both): the cleanup model (writer.rs), meeting summaries, and the saved notes (text only).

pub mod writer;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub fn data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let d = base.join("com.itwelaibomu.mosaic").join("voice");
    let _ = std::fs::create_dir_all(d.join("meetings"));
    d
}

fn meetings_dir() -> PathBuf {
    data_dir().join("meetings")
}

/// Field notes clients as (id, name), read from the Field notes data folder.
fn clients() -> Vec<(String, String)> {
    let base = dirs::data_dir().unwrap_or_else(std::env::temp_dir);
    let path = base.join("com.cavemancreative.fieldnotes").join("clients.json");
    let v: Value = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    v.as_array()
        .map(|a| a.iter().filter_map(|c| Some((c["id"].as_str()?.to_string(), c["name"].as_str()?.to_string()))).collect())
        .unwrap_or_default()
}

fn fold(s: &str) -> String {
    s.to_lowercase().chars().map(|c| match c {
        'à' | 'â' | 'ä' | 'á' => 'a', 'é' | 'è' | 'ê' | 'ë' => 'e', 'î' | 'ï' | 'í' => 'i',
        'ô' | 'ö' | 'ó' => 'o', 'ù' | 'û' | 'ü' | 'ú' => 'u', 'ç' => 'c', c => c,
    }).collect()
}

/// Fallback when the model says none: the client whose name words come up most (at least twice).
fn guess_client(text: &str, clients: &[(String, String)]) -> Option<String> {
    let t = fold(text);
    const SKIP: [&str; 6] = ["coach", "card", "the", "des", "les", "vous"];
    clients
        .iter()
        .map(|(id, name)| {
            let n: usize = fold(name)
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| w.len() >= 3 && !SKIP.contains(w))
                .map(|w| t.matches(w).count())
                .sum();
            (id, n)
        })
        .filter(|(_, n)| *n >= 2)
        .max_by_key(|(_, n)| *n)
        .map(|(id, _)| id.clone())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Line {
    pub speaker: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub app: String,
    pub started_at: String,
    pub ended_at: String,
    #[serde(default)]
    pub minutes: u64,
    pub summary: String,
    pub lines: Vec<Line>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingListItem {
    pub id: String,
    pub title: String,
    pub app: String,
    pub started_at: String,
    pub minutes: u64,
    pub client: Option<String>,
}

enum Job {
    Cleanup { id: i64, text: String },
    Summarize { meeting: Value },
}

pub struct Voice {
    stdin: Mutex<Option<ChildStdin>>,
    jobs: Mutex<Option<Sender<Job>>>,
    perm_waiters: Mutex<Vec<(String, Sender<bool>)>>,
}

impl Voice {
    fn send(&self, v: Value) {
        if let Some(s) = self.stdin.lock().unwrap().as_mut() {
            let _ = writeln!(s, "{v}");
            let _ = s.flush();
        }
    }
}

fn read_lines(path: &PathBuf) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// The writer thread owns the model (llama.cpp contexts are not Send).
fn spawn_writer(app: AppHandle, voice: Arc<Voice>) -> Sender<Job> {
    let (tx, rx) = channel::<Job>();
    std::thread::spawn(move || {
        let dir = data_dir();
        let model_path = dir.join(writer::MODEL_FILE);
        if !model_path.exists() {
            let _ = app.emit("voice-status", json!({"state": "downloading"}));
            let part = dir.join(format!("{}.part", writer::MODEL_FILE));
            let ok = Command::new("curl")
                .args(["-sfL", "-o"])
                .arg(&part)
                .arg(writer::MODEL_URL)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !ok || std::fs::rename(&part, &model_path).is_err() {
                let _ = std::fs::remove_file(&part);
                eprintln!("[voice] model download failed; dictation will paste raw text");
            }
        }
        let w = writer::Writer::load(&model_path).map_err(|e| eprintln!("[voice] model load failed: {e}")).ok();
        let examples: Vec<writer::Example> = std::fs::read_to_string(dir.join("examples.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let vocab = read_lines(&dir.join("vocabulary.txt"));
        let mut session = w.as_ref().and_then(|w| w.cleanup_session(&vocab, &examples).ok());
        let _ = app.emit("voice-status", json!({"state": "ready"}));

        for job in rx {
            match job {
                Job::Cleanup { id, text } => {
                    let out = match (w.as_ref(), session.as_mut()) {
                        (Some(w), Some(s)) => w.cleanup(s, &text),
                        _ => text,
                    };
                    voice.send(json!({"cmd": "paste", "id": id, "text": out}));
                }
                Job::Summarize { meeting } => {
                    let id = meeting["id"].as_str().unwrap_or_default().to_string();
                    let lines: Vec<Line> = serde_json::from_value(meeting["lines"].clone()).unwrap_or_default();
                    let started = meeting["startedAt"].as_str().unwrap_or_default().to_string();
                    let ended = meeting["endedAt"].as_str().unwrap_or_default().to_string();
                    let minutes = match (
                        chrono_secs(&started),
                        chrono_secs(&ended),
                    ) {
                        (Some(a), Some(b)) if b > a => ((b - a) / 60).max(1) as u64,
                        _ => 1,
                    };
                    let transcript: String =
                        lines.iter().map(|l| format!("{}: {}", l.speaker, l.text)).collect::<Vec<_>>().join("\n");
                    let cl = clients();
                    let (title, summary, picked) = w
                        .as_ref()
                        .and_then(|w| w.summarize(&transcript, minutes, &cl).ok())
                        .unwrap_or_else(|| (format!("{} meeting", meeting["app"].as_str().unwrap_or("")), String::new(), None));
                    let client = picked.or_else(|| guess_client(&format!("{title}\n{summary}\n{transcript}"), &cl));
                    let m = Meeting {
                        id: id.clone(),
                        title: title.clone(),
                        app: meeting["app"].as_str().unwrap_or_default().to_string(),
                        started_at: started,
                        ended_at: ended,
                        minutes,
                        summary,
                        lines,
                        client,
                    };
                    let path = meetings_dir().join(format!("{id}.json"));
                    let saved = serde_json::to_string_pretty(&m).ok().and_then(|s| std::fs::write(&path, s).ok()).is_some();
                    voice.send(json!({"cmd": "meeting-saved", "id": id, "title": title, "minutes": minutes, "failed": !saved}));
                    let _ = app.emit("voice-meetings-changed", json!({"id": id}));
                }
            }
        }
    });
    tx
}

/// Seconds since the epoch from an ISO-8601 UTC timestamp like 2026-11-12T20:03:11Z.
fn chrono_secs(s: &str) -> Option<i64> {
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let d: Vec<i64> = date.split('-').filter_map(|x| x.parse().ok()).collect();
    let t: Vec<i64> = time.split(&[':', '.', '+'][..]).take(3).filter_map(|x| x.parse().ok()).collect();
    if d.len() != 3 || t.len() < 3 {
        return None;
    }
    // days from civil (Howard Hinnant)
    let (y, m) = if d[1] <= 2 { (d[0] - 1, d[1] + 9) } else { (d[0], d[1] - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + d[2] - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146097 + doe - 719468) * 86400 + t[0] * 3600 + t[1] * 60 + t[2])
}

pub fn start(app: &AppHandle) {
    let voice = Arc::new(Voice { stdin: Mutex::new(None), jobs: Mutex::new(None), perm_waiters: Mutex::new(Vec::new()) });
    app.manage(voice.clone());
    let tx = spawn_writer(app.clone(), voice.clone());
    *voice.jobs.lock().unwrap() = Some(tx);

    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().ok();
        let helper = exe.as_ref().and_then(|e| e.parent()).map(|d| d.join("mosaic-voice"));
        let Some(helper) = helper.filter(|p| p.exists()) else {
            eprintln!("[voice] mosaic-voice helper not found next to the app binary");
            return;
        };
        let mut child = match Command::new(&helper).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[voice] could not start helper: {e}");
                return;
            }
        };
        *voice.stdin.lock().unwrap() = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let app2 = app.clone();
        let v2 = voice.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
                match ev["type"].as_str().unwrap_or("") {
                    "dictation-raw" => {
                        let job = Job::Cleanup {
                            id: ev["id"].as_i64().unwrap_or(-1),
                            text: ev["text"].as_str().unwrap_or_default().to_string(),
                        };
                        if let Some(tx) = v2.jobs.lock().unwrap().as_ref() {
                            let _ = tx.send(job);
                        }
                    }
                    "meeting-transcript" => {
                        if let Some(tx) = v2.jobs.lock().unwrap().as_ref() {
                            let _ = tx.send(Job::Summarize { meeting: ev.clone() });
                        }
                    }
                    "perm" => {
                        let kind = ev["kind"].as_str().unwrap_or_default().to_string();
                        let granted = ev["granted"].as_bool().unwrap_or(false);
                        let mut w = v2.perm_waiters.lock().unwrap();
                        w.retain(|(k, tx)| if *k == kind { let _ = tx.send(granted); false } else { true });
                    }
                    "open-meeting" => {
                        if let Some(w) = app2.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                        let _ = app2.emit("voice-open-meeting", ev.clone());
                    }
                    _ => {
                        let _ = app2.emit("voice-event", ev.clone());
                    }
                }
            }
            let _ = child.wait();
        });
    }

    #[cfg(target_os = "windows")]
    {
        // TODO(windows): Right Alt hold / double-tap (WH_KEYBOARD_LL), cpal mic + WASAPI loopback,
        // Parakeet TDT 0.6B v3 through transcribe-rs, mic-in-use detection from the
        // CapabilityAccessManager ConsentStore, and a non-activating overlay window.
        eprintln!("[voice] Windows voice input is not built yet");
    }
}

#[tauri::command]
pub fn voice_meetings() -> Vec<MeetingListItem> {
    let mut out: Vec<MeetingListItem> = std::fs::read_dir(meetings_dir())
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|s| serde_json::from_str::<Meeting>(&s).ok())
        .map(|m| MeetingListItem { id: m.id, title: m.title, app: m.app, started_at: m.started_at, minutes: m.minutes, client: m.client })
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    out
}

fn safe_id(id: &str) -> Result<&str, String> {
    if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(id)
    } else {
        Err("bad id".into())
    }
}

#[tauri::command]
pub fn voice_meeting(id: String) -> Result<Meeting, String> {
    let id = safe_id(&id)?;
    let s = std::fs::read_to_string(meetings_dir().join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_delete_meeting(id: String) -> Result<(), String> {
    let id = safe_id(&id)?;
    std::fs::remove_file(meetings_dir().join(format!("{id}.json"))).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_clients() -> Vec<(String, String)> {
    clients()
}

#[tauri::command]
pub fn voice_set_meeting_client(id: String, client: Option<String>) -> Result<(), String> {
    let id = safe_id(&id)?;
    let path = meetings_dir().join(format!("{id}.json"));
    let mut m: Meeting = serde_json::from_str(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    m.client = client.filter(|c| !c.is_empty());
    std::fs::write(&path, serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn voice_notes(state: tauri::State<'_, Arc<Voice>>, start: bool) {
    state.send(if start { json!({"cmd": "start-notes"}) } else { json!({"cmd": "stop-notes"}) });
}

/// Voice permissions for the setup screen: "microphone", "accessibility", "systemAudio".
/// With `request`, macOS's prompt (or the right Settings page) is shown first.
#[tauri::command]
pub async fn voice_permission(state: tauri::State<'_, Arc<Voice>>, kind: String, request: bool) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Ok(true);
    }
    let (tx, rx) = channel::<bool>();
    state.perm_waiters.lock().unwrap().push((kind.clone(), tx));
    state.send(json!({"cmd": "perm", "kind": kind, "request": request}));
    // The mic prompt waits for the person to answer, so allow plenty of time.
    let wait = if request { 120 } else { 5 };
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(wait)).unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}
