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
