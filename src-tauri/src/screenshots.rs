use base64::Engine;
use std::path::PathBuf;

#[derive(serde::Serialize)]
pub struct Screenshot {
    path: String,
    name: String,
    modified: u64,
}

#[derive(serde::Serialize)]
pub struct ScreenshotList {
    folder: String,
    files: Vec<Screenshot>,
}

fn list(folder: PathBuf) -> Result<ScreenshotList, String> {
    let entries = std::fs::read_dir(&folder).map_err(|e| format!("Cannot read {}: {}", folder.display(), e))?;
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "heic" | "tiff") { continue; }
        let Ok(metadata) = entry.metadata() else { continue; };
        if !metadata.is_file() { continue; }
        let modified = metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
        files.push(Screenshot { path: path.to_string_lossy().into_owned(), name: entry.file_name().to_string_lossy().into_owned(), modified });
    }
    files.sort_by(|a,b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    files.truncate(30);
    Ok(ScreenshotList { folder: folder.to_string_lossy().into_owned(), files })
}

#[tauri::command]
pub async fn list_screenshots(folder: Option<String>) -> Result<ScreenshotList, String> {
    let folder = folder.map(PathBuf::from).unwrap_or_else(|| {
        let desktop = dirs::desktop_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
        let screenshots = desktop.join("Screenshots");
        if screenshots.is_dir() { screenshots } else { desktop }
    });
    tokio::task::spawn_blocking(move || list(folder)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn screenshot_thumbnail(path: String, size: Option<u32>) -> Result<String, String> {
    let size = size.unwrap_or(160).clamp(32, 2400);
    tokio::task::spawn_blocking(move || {
        use std::hash::{Hash, Hasher};
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hash);
        metadata.modified().ok().hash(&mut hash);
        metadata.len().hash(&mut hash);
        size.hash(&mut hash);
        let cache = std::env::temp_dir().join("mosaic-screenshot-thumbnails");
        std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let output = cache.join(format!("{:x}.png", hash.finish()));
        if !output.exists() {
            let result = std::process::Command::new("sips").args(["-s", "format", "png", "-Z", &size.to_string(), &path, "--out"]).arg(&output).output().map_err(|e| e.to_string())?;
            if !result.status.success() { return Err(String::from_utf8_lossy(&result.stderr).into_owned()); }
        }
        let bytes = std::fs::read(output).map_err(|e| e.to_string())?;
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gallery_filters_sorts_and_limits_to_thirty() {
        let dir = std::env::temp_dir().join(format!("mosaic-gallery-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..35 {
            let file = std::fs::File::create(dir.join(format!("image-{i:02}.png"))).unwrap();
            file.set_times(std::fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(i))).unwrap();
        }
        std::fs::write(dir.join("ignore.txt"), b"test").unwrap();
        std::fs::create_dir_all(dir.join("directory.png")).unwrap();
        let result = list(dir.clone()).unwrap();
        assert_eq!(result.files.len(), 30);
        assert_eq!(result.files[0].name, "image-34.png");
        assert_eq!(result.files[29].name, "image-05.png");
        assert!(result.files.iter().all(|f| f.name.starts_with("image-")));
        assert!(result.files.windows(2).all(|w| w[0].modified >= w[1].modified));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
