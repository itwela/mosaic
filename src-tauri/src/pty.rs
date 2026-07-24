use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create(
        &self,
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        app: AppHandle,
    ) -> Result<(), String> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
        // Inherit HOME and USER so the prompt resolves correctly
        if let Ok(home) = std::env::var("HOME") { cmd.env("HOME", home); }
        if let Ok(user) = std::env::var("USER") { cmd.env("USER", user); }
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let master = pair.master;
        let writer = master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

        let session_id = id.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let event = format!("pty-data-{}", session_id);
                        let _ = app_handle.emit(&event, data);
                    }
                }
            }
            let _ = app_handle.emit(&format!("pty-exit-{}", session_id), ());
        });

        let session = PtySession {
            writer,
            master,
            _child: child,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(id, session);

        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(id) {
            session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err(format!("PTY session {} not found", id))
        }
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(id) {
            session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            }).map_err(|e| e.to_string())
        } else {
            Err(format!("PTY session {} not found", id))
        }
    }

    pub fn kill(&self, id: &str) {
        self.sessions.lock().unwrap().remove(id);
    }
}
