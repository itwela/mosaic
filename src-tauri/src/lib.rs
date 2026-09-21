mod pty;

use pty::PtyManager;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::MacosLauncher;

pub struct AppState {
    pub pty_manager: Arc<PtyManager>,
}

#[tauri::command]
async fn pty_create(
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.create(id, cols, rows, cwd, app)
}

#[tauri::command]
async fn pty_write(
    id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.write(&id, &data)
}

#[tauri::command]
async fn pty_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.pty_manager.resize(&id, cols, rows)
}

#[tauri::command]
async fn pty_kill(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.pty_manager.kill(&id);
    Ok(())
}

#[tauri::command]
async fn get_file_preview(path: String) -> Result<Option<String>, String> {
    use base64::Engine;
    let enc = base64::engine::general_purpose::STANDARD;

    let p = std::path::Path::new(&path);
    let ext = p.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Direct image — read and encode
    if matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let mime = match ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif"          => "image/gif",
            "webp"         => "image/webp",
            _              => "image/png",
        };
        return Ok(Some(format!("data:{};base64,{}", mime, enc.encode(&bytes))));
    }

    // Plain text files — return a snippet
    if matches!(ext.as_str(), "md" | "txt" | "markdown") {
        if let Ok(content) = std::fs::read_to_string(&path) {
            let snippet: String = content.chars().take(250).collect();
            return Ok(Some(format!("text:{}", snippet)));
        }
    }

    // App bundle — extract icon via sips
    if path.ends_with(".app") {
        let resources = format!("{}/Contents/Resources", path);
        eprintln!("[preview] scanning resources: {}", resources);

        match std::fs::read_dir(&resources) {
            Err(e) => eprintln!("[preview] read_dir failed: {}", e),
            Ok(entries) => {
                for entry in entries.flatten() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if fname.ends_with(".icns") {
                        let icns = entry.path().to_string_lossy().to_string();
                        eprintln!("[preview] found icns: {}", icns);

                        let slug: String = path.chars()
                            .filter(|c| c.is_alphanumeric())
                            .take(40)
                            .collect();
                        let out = format!("/tmp/mosaic_icon_{}.png", slug);

                        let result = std::process::Command::new("sips")
                            .args(["-s", "format", "png", &icns,
                                   "--out", &out,
                                   "--resampleHeightWidth", "128", "128"])
                            .output();

                        match result {
                            Err(e) => eprintln!("[preview] sips spawn failed: {}", e),
                            Ok(o) => {
                                eprintln!("[preview] sips exit={} stderr={}", o.status,
                                    String::from_utf8_lossy(&o.stderr));
                                if o.status.success() {
                                    match std::fs::read(&out) {
                                        Err(e) => eprintln!("[preview] read png failed: {}", e),
                                        Ok(bytes) => {
                                            return Ok(Some(format!(
                                                "data:image/png;base64,{}",
                                                enc.encode(&bytes)
                                            )));
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
                eprintln!("[preview] no .icns found in resources");
            }
        }
    }

    Ok(None)
}

#[derive(serde::Serialize)]
struct ExportedFile {
    name: String,
    data: String,
}

#[tauri::command]
fn read_file_for_export(path: String) -> Result<Option<ExportedFile>, String> {
    use base64::Engine;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 25 * 1024 * 1024 {
        return Ok(None);
    }
    let name = std::path::Path::new(&path)
        .file_name().and_then(|n| n.to_str()).unwrap_or("file")
        .to_string();
    let data = base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path).map_err(|e| e.to_string())?);
    Ok(Some(ExportedFile { name, data }))
}

#[tauri::command]
fn restore_exported_file(workspace_name: String, name: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let safe_workspace = workspace_name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect::<String>();
    let safe_name = std::path::Path::new(&name).file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let root = dirs::home_dir().ok_or("Could not locate the home directory")?.join("Mosaic Workspaces").join(safe_workspace);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join(safe_name);
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct AppEntry {
    name: String,
    path: String,
}

#[tauri::command]
fn list_applications() -> Vec<AppEntry> {
    let mut apps = Vec::new();
    for dir in &["/Applications", "/System/Applications"] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with(".app") {
                    apps.push(AppEntry {
                        name: fname.trim_end_matches(".app").to_string(),
                        path: entry.path().to_string_lossy().to_string(),
                    });
                }
            }
        }
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(PtyManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState { pty_manager })
        .invoke_handler(tauri::generate_handler![pty_create, pty_write, pty_resize, pty_kill, list_applications, open_path, get_file_preview, read_file_for_export, restore_exported_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
