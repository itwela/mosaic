use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    shell_pid: u32,
    last_activity: Arc<Mutex<Instant>>,
}

#[derive(serde::Serialize)]
pub struct SessionStatus {
    pub id: String,
    pub foreground: String,
    pub chain: Vec<String>,
    pub running: bool,
    pub silent_ms: u64,
    pub has_process: bool,
    pub hook_state: Option<String>,
    pub hook_at: Option<u64>,
}

// pid -> (ppid, full_command, running)
type PsRow = (u32, String, bool);

fn ps_snapshot() -> HashMap<u32, PsRow> {
    let mut map = HashMap::new();
    let Ok(out) = std::process::Command::new("ps")
        // `comm` is truncated to 16 chars on macOS (so "codex" becomes
        // "/Users/itwelaibo…"), which breaks agent detection. Use `command`
        // (the full argv) instead so the real binary name is always present.
        .args(["-axo", "pid=,ppid=,stat=,command="])
        .output()
    else {
        return map;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        let mut it = line.split_whitespace();
        let (Some(pid_s), Some(ppid_s), Some(stat)) = (it.next(), it.next(), it.next())
        else {
            continue;
        };
        let (Ok(pid), Ok(ppid)) = (pid_s.parse::<u32>(), ppid_s.parse::<u32>()) else {
            continue;
        };
        // Everything after pid/ppid/stat is the full command (may contain spaces).
        let command = it.collect::<Vec<_>>().join(" ");
        map.insert(pid, (ppid, command, stat.starts_with('R')));
    }
    map
}

fn build_children(snap: &HashMap<u32, PsRow>) -> HashMap<u32, Vec<u32>> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, (ppid, _, _)) in snap {
        children.entry(*ppid).or_default().push(*pid);
    }
    children
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
        // If a session with this id already exists (a terminal that got remounted
        // after a panel reorder), reuse it instead of spawning a fresh shell and
        // losing whatever was running. Just resize it to the new cell.
        {
            let sessions = self.sessions.lock().unwrap();
            if let Some(session) = sessions.get(&id) {
                let _ = session.master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
                return Ok(());
            }
        }

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
        // Spawn a login shell (-l). Mosaic used to start a plain non-login zsh,
        // which sources .zshenv/.zshrc but SKIPS .zprofile — so the Homebrew
        // PATH setup (brew shellenv → /opt/homebrew/bin) never ran, and things
        // like rbenv and opencode were "command not found" only inside Mosaic.
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Mosaic is its own terminal, not Apple Terminal. The shell inherits
        // TERM_SESSION_ID from whatever launched Mosaic, which makes macOS's
        // /etc/zshrc_Apple_Terminal turn on its save/restore feature and spam
        // "Restored session:" / "Saving session..." into every new shell.
        // SHELL_SESSIONS_DISABLE=1 is that script's documented off-switch.
        cmd.env("SHELL_SESSIONS_DISABLE", "1");
        cmd.env("TERM_PROGRAM", "mosaic");
        // Lets agent hooks report back which tab they're running in.
        cmd.env("MOSAIC_TAB_ID", &id);
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
        // Inherit HOME and USER so the prompt resolves correctly
        if let Ok(home) = std::env::var("HOME") { cmd.env("HOME", home); }
        if let Ok(user) = std::env::var("USER") { cmd.env("USER", user); }
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let shell_pid = child.process_id().unwrap_or(0);
        let master = pair.master;
        let writer = master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

        let last_activity = Arc::new(Mutex::new(Instant::now()));
        let last_activity_clone = last_activity.clone();

        let session_id = id.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        *last_activity_clone.lock().unwrap() = Instant::now();
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
            shell_pid,
            last_activity,
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
        crate::agents::clear_hook_state(id);
    }

    pub fn statuses(&self) -> Vec<SessionStatus> {
        let snapshot = ps_snapshot();
        let children = build_children(&snapshot);

        let sessions = self.sessions.lock().unwrap();
        sessions
            .iter()
            .map(|(id, s)| {
                let silent_ms = s.last_activity.lock().unwrap().elapsed().as_millis() as u64;

                // Walk from the shell down to the deepest foreground process so
                // the frontend can tell *what* is running (an agent?) and
                // whether it is actively working.
                let mut chain: Vec<String> = Vec::new();
                let mut running = false;
                let mut foreground = String::new();
                let mut max_depth: i32 = -1;
                let mut stack: Vec<(u32, i32)> = vec![(s.shell_pid, 0)];
                let mut visited = std::collections::HashSet::new();

                while let Some((pid, depth)) = stack.pop() {
                    if !visited.insert(pid) {
                        continue;
                    }
                    if let Some((_, comm, r)) = snapshot.get(&pid) {
                        chain.push(comm.clone());
                        if *r {
                            running = true;
                        }
                        let has_child = children
                            .get(&pid)
                            .map(|c| !c.is_empty())
                            .unwrap_or(false);
                        if !has_child {
                            if depth > max_depth {
                                max_depth = depth;
                                foreground = comm.clone();
                            }
                        } else if let Some(kids) = children.get(&pid) {
                            for cpid in kids {
                                stack.push((*cpid, depth + 1));
                            }
                        }
                    }
                }

                if foreground.is_empty() {
                    foreground = chain.last().cloned().unwrap_or_default();
                }

                let hook = crate::agents::read_hook_state(id);
                SessionStatus {
                    hook_state: hook.as_ref().map(|(state, _)| state.clone()),
                    hook_at: hook.map(|(_, at)| at),
                    id: id.clone(),
                    foreground,
                    has_process: chain.len() > 1,
                    chain,
                    running,
                    silent_ms,
                }
            })
            .collect()
    }
}
