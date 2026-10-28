// Backend for the Fieldnotes view (public/fieldnotes), ported from the
// standalone Fieldnotes app.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_SCREENSHOT_BYTES: u64 = 25 * 1024 * 1024;

// Share the standalone Fieldnotes app's data folder so existing clients,
// notes and screenshots show up in Mosaic unchanged.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .with_file_name("com.cavemancreative.fieldnotes");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn fieldnotes_load_state(app: AppHandle) -> Result<Value, String> {
    let path = data_dir(&app)?.join("checklists.json");
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn fieldnotes_save_state(app: AppHandle, state: Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("checklists.json");
    let temporary = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(&state).map_err(|error| error.to_string())?;
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

#[derive(Serialize)]
pub struct ScreenshotInfo {
    id: String,
    name: String,
    extension: String,
}

fn supported_image_extension(path: &std::path::Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp")
        .then_some(extension)
}

#[tauri::command]
pub fn fieldnotes_import_screenshot(app: AppHandle, source_path: String) -> Result<ScreenshotInfo, String> {
    let source = PathBuf::from(&source_path);
    let extension = supported_image_extension(&source)
        .ok_or_else(|| "Drop a PNG, JPG, GIF, or WebP screenshot.".to_string())?;
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SCREENSHOT_BYTES {
        return Err("Screenshots must be files under 25 MB.".to_string());
    }
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Screenshot")
        .to_string();
    let id = Uuid::new_v4().to_string();
    let destination = data_dir(&app)?.join(format!("{id}.{extension}"));
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(ScreenshotInfo { id, name, extension })
}

#[tauri::command]
pub fn fieldnotes_save_screenshot_data(app: AppHandle, name: String, data_url: String) -> Result<ScreenshotInfo, String> {
    let extension = PathBuf::from(&name)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Screenshot file needs an image extension.".to_string())?;
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Err("Drop a PNG, JPG, GIF, or WebP screenshot.".to_string());
    }
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Could not read screenshot data.".to_string())?;
    let expected_mime = match extension.as_str() {
        "png" => "data:image/png;base64",
        "jpg" | "jpeg" => "data:image/jpeg;base64",
        "gif" => "data:image/gif;base64",
        "webp" => "data:image/webp;base64",
        _ => unreachable!(),
    };
    if header != expected_mime || encoded.len() as u64 > MAX_SCREENSHOT_BYTES * 2 {
        return Err("Screenshot type is not supported or file is over 25 MB.".to_string());
    }
    let bytes = STANDARD.decode(encoded).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SCREENSHOT_BYTES {
        return Err("Screenshots must be under 25 MB.".to_string());
    }
    let id = Uuid::new_v4().to_string();
    fs::write(data_dir(&app)?.join(format!("{id}.{extension}")), bytes)
        .map_err(|error| error.to_string())?;
    Ok(ScreenshotInfo { id, name, extension })
}

#[tauri::command]
pub fn fieldnotes_read_screenshot(app: AppHandle, id: String, extension: String) -> Result<String, String> {
    let id = Uuid::parse_str(&id).map_err(|_| "Invalid screenshot id".to_string())?;
    let extension = extension.to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return Err("Unsupported screenshot format".to_string()),
    };
    let bytes = fs::read(data_dir(&app)?.join(format!("{id}.{extension}")))
        .map_err(|error| error.to_string())?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn fieldnotes_remove_screenshot(app: AppHandle, id: String, extension: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|_| "Invalid screenshot id".to_string())?;
    let extension = extension.to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        return Err("Unsupported screenshot format".to_string());
    }
    let path = data_dir(&app)?.join(format!("{id}.{extension}"));
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn fieldnotes_write_export(app: AppHandle, file_name: String, contents: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' })
        .collect();
    if !safe.ends_with(".json") {
        return Err("Exports must be .json files.".to_string());
    }
    let dir = app.path().download_dir().map_err(|error| error.to_string())?;
    let path = dir.join(safe);
    fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn fieldnotes_write_pdf(app: AppHandle, file_name: String, data_base64: String) -> Result<String, String> {
    let safe: String = file_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' })
        .collect();
    if !safe.ends_with(".pdf") {
        return Err("PDF exports must be .pdf files.".to_string());
    }
    let bytes = STANDARD.decode(data_base64).map_err(|error| error.to_string())?;
    let dir = app.path().download_dir().map_err(|error| error.to_string())?;
    let path = dir.join(safe);
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
