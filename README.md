# Mosaic

A desktop app that gives you **workspaces of terminals** in a resizable grid.

Instead of juggling a dozen scattered terminal tabs, you group them. Each
**workspace** holds a grid of panels, and each panel is either:

- a **terminal** — a real shell (with tabs), backed by a native PTY, or
- a **launcher** — a panel of shortcuts to files, folders, apps, and URLs you
  open with one click.

Switch between workspaces from the sidebar. Terminals stay alive in the
background, so nothing restarts when you jump around. Everything you set up is
saved automatically, so your layout is there next time you open it.

Built with [Tauri](https://tauri.app) (Rust) + React + TypeScript.

## Workshop dashboard

The workspace view opens with three instruments. None of them invent numbers.

- **Status ring.** Working, need-you, and ready counts come from each terminal's live session (`pty_statuses`) plus what its screen is showing. The center number is how many of this workspace's terminals are actually doing something. An idle workspace reads 00.
- **Incoming approvals.** A terminal in another workspace that is waiting on you shows its real prompt. Approve and Deny call the existing `pty_write` command with the keystrokes for the choice on screen (a numbered option such as `1`, otherwise `y` / `n`). That types the answer into that agent's own shell. Open switches to the workspace and focuses the tab. Reply, on the terminal itself, sends a line you type.
- **Field notes.** The Field notes page posts its checklist totals after every render. Those totals are the client's tasks plus the progress saved on this machine. `public/fieldnotes/my-clients.js`, `workstreams-data.js`, and `files/` stay gitignored and are never rewritten. If they are not on this computer, the card says so instead of showing a fake total.
- **Clear all** hides screenshots already in the strip. It does not delete the files. A newer shot appears on the next refresh. Pick the folder once in Settings; Mosaic does not scan Desktop.
- **AI usage** is whatever each provider reports through `provider_usage`. A missing login stays a missing login.

---

## Requirements

You need three things installed before you can run Mosaic from source:

1. **Node.js** (v18 or newer) — https://nodejs.org
2. **Rust** — https://rustup.rs
3. **Tauri's system dependencies** for your OS — follow the short list on the
   official page: https://tauri.app/start/prerequisites/
   (On macOS this is just the Xcode Command Line Tools: `xcode-select --install`.)

## Run it (development)

```bash
# 1. Get the code
git clone https://github.com/itwela/mosaic.git
cd mosaic

# 2. Install the frontend dependencies
npm install

# 3. Launch the app
npm run tauri dev
```

The first launch compiles the Rust side, so it takes a few minutes. After that
it's fast.

## Build a real app (optional)

To produce an installable app bundle for your machine:

```bash
npm run tauri build
```

The finished app lands in `src-tauri/target/release/bundle/`.

## Getting updates later

Because Mosaic lives on GitHub, you don't reinstall to get new versions. From
your `mosaic` folder:

```bash
git pull
npm install
npm run tauri dev
```

`git pull` grabs whatever has changed since you last cloned it — that's the
whole point of pulling from a repo instead of a one-time copy.

## License

MIT — see [LICENSE](LICENSE). Use it, change it, share it.
