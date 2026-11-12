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
# macOS only, once per Mac: creates a local code-signing identity in your login keychain
npm run signing:setup
npm run tauri build
```

macOS installed builds use the same signing certificate on every update so saved
privacy grants can match the updated app. The build wrapper refuses ad-hoc signing.
The setup command creates `Mosaic Local Development` with user-level code-signing
trust only; it does not add TLS trust or grant file access. Its private key remains
in your login keychain and codesign is the only allowed application. Keep that
identity for future builds. `APPLE_SIGNING_IDENTITY` can select an existing Apple
signing certificate instead. A local certificate is for this Mac's own builds;
distribution to other people should use Developer ID signing and notarization.

After switching from an ad-hoc build, macOS may ask you to approve the signed app
once. Setup verifies real directory enumeration for Desktop, Documents and
Downloads, which are separate permissions. Full Disk Access may require quitting
and reopening Mosaic before the new grant takes effect.

The finished app lands in `src-tauri/target/release/bundle/`.

## Getting updates later

### Field notes data

Mosaic automatically reads the local Field notes data files from the checkout
it was built from. Changes to `public/fieldnotes/my-clients.js` and
`workstreams-data.js` appear within two seconds, including in the installed
app. There is no consumer sync command, app rebuild, or reinstall for data edits.
The source checkout must remain at its build location for this local workflow.

Open note/screenshot dialogs delay refresh until dismissed. Saved statuses,
notes, and attachments remain in `checklists.json`; keep task IDs stable to
retain them. Incomplete or invalid source edits keep the last displayed data
and are retried automatically.

If the source checkout is absent, Mosaic reads `clients.json` from its shared
Field notes data directory, falling back to its bundled clients when no file
exists. `scripts/sync-fieldnotes.mjs` is an optional developer export tool for
creating that portable JSON snapshot, not part of the consumer workflow.

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
