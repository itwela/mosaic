//! First-run actions. No permission or configuration change runs until clicked.
use std::{fs, path::Path};
use toml_edit::{Document, value};

// Opening an iterator alone is not a read: errors can arrive on the first entry.
// Advance it before reporting access, including for an empty directory.
fn check_directory(path: &Path) -> std::io::Result<()> {
    fs::read_dir(path)?.next().transpose()?;
    Ok(())
}

// Match setup to the same designated requirement that macOS uses for grants.
// Never enumerate protected folders here: startup only checks identity, and
// permission requests remain behind the visible setup action.
#[cfg(target_os = "macos")]
fn read_designated_requirement(exe: &Path) -> Result<String, String> {
    let output = std::process::Command::new("/usr/bin/codesign")
        .args(["-d", "-r-"]).arg(exe).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("Could not read Mosaic's signing identity".into()); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout.lines().chain(stderr.lines())
        .find_map(|line| line.strip_prefix("designated => "))
        .filter(|line| !line.is_empty()).map(str::to_owned)
        .ok_or_else(|| "Mosaic has no designated signing requirement".into())
}

#[tauri::command]
pub fn setup_identity() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        read_designated_requirement(&exe)
    }
    #[cfg(not(target_os = "macos"))]
    { Ok("com.itwelaibomu.mosaic.setup-v1".into()) }
}

#[tauri::command]
pub async fn setup_folders() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = dirs::home_dir().ok_or("Home folder unavailable")?;
        let mut denied = Vec::new();
        for name in ["Desktop", "Documents", "Downloads"] {
            if let Err(e) = check_directory(&home.join(name)) { denied.push(format!("{name}: {e}")); }
        }
        if denied.is_empty() { Ok(()) } else { Err(denied.join("\n")) }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn setup_disk_access() -> bool {
    // Read only a protected directory's entries, never its contents. There is no
    // public TCC query API; failure must stay pending rather than claim a grant.
    dirs::home_dir().is_some_and(|h| check_directory(&h.join("Library/Safari")).is_ok())
}

#[tauri::command]
pub fn setup_open_disk_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .status().map_err(|e| e.to_string())?
        .success().then_some(()).ok_or("Could not open System Settings".into())
}

fn notifications_config(source: &str) -> Result<String, String> {
    let mut doc = source.parse::<Document>().map_err(|e| e.to_string())?;
    if doc.get("tui").is_none() { doc["tui"] = toml_edit::Item::Table(toml_edit::Table::new()); }
    if !doc["tui"].is_table_like() { return Err("The tui configuration is not a table".into()); }
    doc["tui"]["notifications"] = value(true);
    Ok(doc.to_string())
}
fn read_config(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn setup_codex_enabled() -> Result<bool, String> {
    let path = dirs::home_dir().ok_or("Home folder unavailable")?.join(".codex/config.toml");
    let doc = read_config(&path)?.parse::<Document>().map_err(|e| e.to_string())?;
    Ok(doc.get("tui").and_then(|t| t.get("notifications")).and_then(|n| n.as_bool()) == Some(true))
}
#[tauri::command]
pub fn setup_enable_codex() -> Result<(), String> {
    let path = dirs::home_dir().ok_or("Home folder unavailable")?.join(".codex/config.toml");
    let source = read_config(&path)?;
    let next = notifications_config(&source)?;
    if source == next { return Ok(()); }
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    if path.exists() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        fs::copy(&path, path.with_extension(format!("toml.mosaic-backup-{stamp}"))).map_err(|e| e.to_string())?;
    }
    fs::write(&path, next).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_check_reads_empty_and_populated_folders_and_rejects_files() {
        let path = std::env::temp_dir().join(format!("mosaic-access-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        assert!(check_directory(&path).is_ok());
        let file = path.join("entry");
        fs::write(&file, b"test").unwrap();
        assert!(check_directory(&path).is_ok());
        assert!(check_directory(&file).is_err());
        assert!(check_directory(&path.join("missing")).is_err());
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn preserves_config_and_enables_existing_table() {
        let input = "# keep\nmodel = 'example'\n[tui]\nnotifications = false # existing\ntheme = 'dark'\n[projects.'/tmp/demo']\ntrust_level = 'trusted'\n";
        let output = notifications_config(input).unwrap();
        assert!(output.contains("# keep"));
        assert!(output.contains("theme = 'dark'"));
        assert!(output.contains("trust_level = 'trusted'"));
        assert!(output.contains("notifications = true"));
        assert_eq!(notifications_config(&output).unwrap(), output);
    }
    #[test]
    fn creates_table_and_rejects_invalid_config() {
        assert!(notifications_config("").unwrap().contains("notifications = true"));
        assert!(notifications_config("tui = 7").is_err());
        assert!(notifications_config("[broken").is_err());
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn reads_designated_requirement_from_signed_binary() {
        let req = read_designated_requirement(Path::new("/Applications/mosaic.app/Contents/MacOS/mosaic")).unwrap();
        assert!(req.contains("identifier \"com.itwelaibomu.mosaic\""), "unexpected requirement: {req}");
    }
}
