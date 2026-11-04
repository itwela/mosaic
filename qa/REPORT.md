# Mosaic redesign QA

**Score: 6/10.** The workshop frame is the right design, but the guide's own approval prompt is never detected, Approve leaves that alarm up, and the ring total, status chips, and usage grid do not match the guide.

Reviewed PR #1 (`cursor/mosaic-redesign-6c1c` into `zen-panel`, commit `2d2cbbd`) against the design-guide image and the mockup source. The bar for done is 9/10. This branch does not change production code.

## How it was tested

Both UIs were shot at **1440×900**, the mockup's unscaled frame (`--fit` is 1 at that size).

- Reference: the uploaded mockup, served locally, after the boot animation settled (`#cWork` reads `02`). Shots are `qa/screenshots/ref-*.png`.
- App: `npm run dev` (Vite on `127.0.0.1:1420`) in headless Chrome. Outside the Tauri webview, `window.isTauri` and `__TAURI_INTERNALS__.invoke` were stubbed in the page so `pty_statuses`, `pty_write`, `provider_usage`, and `list_screenshots` could be driven. Prompt text was written into xterm through the `pty-data-*` listener, the same path a PTY uses. Shots are `qa/screenshots/app-*.png`.
- Field notes absence used the real tree: `my-clients.js`, `workstreams-data.js`, and `files/` are not on this machine. A second load answered those script URLs only inside the browser, to prove the dashboard reads the page rather than a hardcoded total.
- `npx tsc --noEmit` passed. There is no lint script and no frontend test script. `cargo check` is below.

## P1 — functional failures

### 1. The design guide's approval prompt is never detected

The incoming card in the guide is **Hala Card · Allow Bash(rm -rf public/old-icons)?** with Approve / Deny / Open. That sentence, including when it is followed by `1. Yes` / `2. No, and tell Claude…`, is classified `unknown`.

`src/lib/agents.ts:128-160`. Claude is recognized only by `do you want to proceed|make this edit|run this|create` (line 130) or by `waiting for your input` / `permission required` (line 160). `Allow Bash(…)?` matches none of those.

Checked two ways:

- Imported the app's own `detectScreenState` in the page. `Allow Bash(rm -rf public/old-icons)?` plus numbered Yes/No returned `{ state: "unknown" }`. `Do you want to proceed?` returned `attention` with approve keystroke `1\r`. Codex `Would you like to run the following command?` returned `attention` with `1\r` / `2\r`.
- Wrote the Allow Bash screen into Hala Card's terminal, padded so it sits in the last 24 rows (`screenWindow` in `agents.ts:93`). The incoming card showed Nym's "Do you want to proceed?", and Hala's sidebar chip stayed off the attention color. All Running still showed the Allow Bash text under a working dot (`qa/screenshots/app-all.png`).

Expected: that prompt is the red incoming card and a red terminal, with Approve / Deny / Open, as in the guide and `qa/screenshots/ref-workspace.png`.

Hooks can still force `attention`, but then `sessionToMeta` falls through to the default offer (`Waiting for approval`, `y\r` / `n\r`) because `extractApproval` only runs when the screen state is already `attention` (`Terminal.tsx:238-239`). The question on screen is dropped.

### 2. Approve sends the key and leaves the alarm up

On Bellhop, the incoming card showed **Nym · Claude Code · just now · Do you want to proceed?** Approve called `pty_write` with `1\r`. The card, the Approve button, and the prompt were still there immediately afterward (`qa/screenshots/app-bellhop.png` then `qa/screenshots/app-after-approve.png`).

`classifyStatus` returns `attention` whenever the screen still says so, before it looks at the answer (`src/lib/agents.ts:180-181`). `answered` is only applied to hook/notification state on the next line. `App.tsx:212-213` says answering should drop the red immediately. It does not, for the screen path that actually draws this card.

Expected: the guide's Approve dismisses the waiting treatment (the mockup removes the alarm and the action row). A second click sends `1` again into a terminal that is still painted as waiting.

Deny and Reply do send the right bytes (below). They have the same latch, so the red chrome stays until the screen text itself changes.

## P2 — visual mismatches against the guide

### 3. Ring center adds in shells the three labels do not show

On Bellhop the ring read **05** beside **02 Working / 01 Need you / 00 Ready** (`qa/screenshots/app-bellhop.png`). The guide's same board is **04** beside **02 / 01 / 00** (`qa/screenshots/ref-workspace.png`).

`WorkspaceDashboard.tsx:51` sets the center to `terminals + working + ready + attention`. The two zsh panes are `terminal` status, so they inflate the center and do not appear in the three labels. All Running does the same sum (`AllRunningView.tsx:57`, center **06** beside 04 working and 02 need-you).

Expected: the guide's center number is the workspace figure printed in the ring (04 on that board), with the three labels reading 02 / 01 / 00.

### 4. Status chips use the old jewel palette

The first live sidebar chip computed to `rgb(47, 111, 214)` (`#2f6fd6`). That is `STATUS_COLORS.terminal` in `src/lib/agents.ts:255-262` (`terminal #2f6fd6`, `running #e08a1e`, `attention #d0304e`). The guide's chips are cream `#F3E2C4`, amber `#FFB547`, and ruby `#FF4A3D` (mockup `counters()`, and the same tokens the ring already uses in `src/lib/approvals.ts` `TONE`). Tab dots take the same `STATUS_COLORS` via `--tab-status`.

Expected: cream / amber / ruby chips and dots, matching the ring and the guide.

### 5. All Running's third figure is Ready, and the guide's is Idle

`AllRunningView.tsx:68` labels the third number **Ready** and binds it to `counts.ready`. The guide and `qa/screenshots/ref-all.png` label it **Idle** (muted), with the footnote "click ↗ to jump to its workspace". The app's footnote says "click the workspace name" (`AllRunningView.tsx:70`). The jump itself works.

### 6. Usage sits in half a row and wraps to two columns

Five panels become a 3-then-2 grid (`WorkspaceGrid.tsx:159`, `Math.ceil(Math.sqrt(n))`), and the second row splits 50/50. Measured usage track: `261.5px 261.5px` (`UsagePanel.css:33-34`, `minmax(220px, 1fr)`). The guide gives Hot Links one column and AI usage the other two, with Claude, Codex, Cursor, Antigravity, and DeepSeek in one row (`qa/screenshots/ref-workspace.png`). DeepSeek is below the fold in `qa/screenshots/app-bellhop.png`.

The card contents (rate-limit copy, percents, reset lines, DeepSeek balance) render when `provider_usage` returns data. The frame they sit in does not match.

### 7. Commands is a stack of cards, and the guide is a heat table

Search works (`qa/screenshots/app-commands.png` filters to the postgres command). The guide is one panel of rows: heat pips, command, label, category, count, Copy (`qa/screenshots/ref-commands.png`). The app is separate glass cards.

### 8. The CRT grade is a light wash

Workshop tokens, Chakra Petch / Geist, square panels, corner brackets, and the glass photo are in place. The guide also puts a red/blue split on every glyph (mockup `.app *` text-shadow), a heavier scanline, grain, and RGB subpixel lines. The app applies the split only through `.ca` (`src/workshop.css:64-66`) and a scan at opacity 0.28 (`workshop.css:82-85`). Body copy in the shots is clean, which reads as a different picture from `qa/screenshots/ref-workspace.png`.

### 9. The Codex sentence printed in the guide is also unrecognized

`Upload to Vercel blob and replace the links in /resources?` returns `unknown`. The real Codex TUI line `Would you like to run the following command?` is recognized, and that pane did grow an Approve / Deny / Reply bar (`qa/screenshots/app-bellhop.png`). The sentence in the guide's middle terminal would not.

## P3 — polish

- Age copy is **just now** for under a minute (`src/lib/approvals.ts:14-16`). The guide's incoming card uses a minute stamp (`0m ago` on the design image, `6m ago` in the mockup source).
- All Running does not toggle back to the workspace. Other nav items do (`App.tsx:414-416`). All Running always sets `view` to `"all"` (`App.tsx:443`). A second click stayed on All Running. The mockup returns to the workspace.
- Terminal header icons are a briefcase and an eraser. The guide uses ⌸ and ⌫.
- The screenshot strip adds a folder glyph before the thumbs. The guide is thumbs plus a count.

## What passed

Checked in the running UI unless noted as a diff or typecheck.

- **Sidebar counts** render per workspace and on All Running, and they change when sessions change (Bellhop went from `2,3` to `0,3` after the zsh sessions dropped out of `pty_statuses`).
- **Status ring** shows Working / Need you / Ready from live status, with the spinning ticks and the "THIS WORKSPACE" label.
- **Incoming card** appears for a prompt the parser knows (`Do you want to proceed?`), from another workspace. Approve writes `1\r`. Deny writes `2\r`. Open switched the title from Bellhop / Kodawari to Hala Card.
- **Reply** on the visible Codex pane opened the field and `pty_write` received `ship the pdfs\r`.
- **Hot links**: search for "vercel" hid mixcloud; A–Z ordered Instagram, then Kodawari · Vercel, then the pdf, then mixcloud; Launch issued `open_path` once per item (`qa/screenshots/app-search.png`).
- **AI usage** renders five providers from `provider_usage` (layout issue is P2).
- **Nav**: All Running, Commands (search), Field notes, New workspace (count increased, title became Workspace 4), Import workspace (a `.json` bundle named "Imported QA" landed in the sidebar), Settings, What's this, Caveman Creative.
- **Clear all** hid the strip and read "Cleared · new shots will show up here".
- **+ Terminal**, **+ Window** (Terminal, Launcher board, AI usage, Field notes, Zen Studio), and **Tuck** are in the top bar. Choosing Zen Studio added a Zen Studio panel (`qa/screenshots/app-window-menu.png`).
- **Field notes, files absent**: the dashboard says "No client data on this machine…" and does not show 92/133 (`qa/screenshots/app-empty.png`). The missing scripts 404 and do not throw. With a browser-only client fixture, the dashboard read the iframe's postMessage as **1 / 3**, **1 active · 2 remaining**, short name VEH, and the Field notes view listed that client (`qa/screenshots/app-notes.png`).
- **Diff hygiene**: `origin/zen-panel...HEAD` does not touch `my-clients.js`, `workstreams-data.js`, or `public/fieldnotes/files/`. `.gitignore` gains `public/fieldnotes/files/`.
- **Drag a panel onto a workspace**: Bellhop went from 5 panels to 4, and Hala Card gained the "claude · listening room" terminal (`qa/screenshots/app-drag.png`). `movePanelToWorkspace` in `src/store/workspaces.ts:145`.
- **Tab rename**: a `dblclick` on the Codex tab opened the input seeded with `codex · nym pdfs`.
- **Settings** keeps the screenshot-folder copy ("it no longer scans Desktop by default"), the macOS file-access row, themes, launch at login, and Claude hooks (`qa/screenshots/app-settings.png`). `list_screenshots` returns an empty list when no folder is set (`src-tauri/src/screenshots.rs:35-42`).
- **`npx tsc --noEmit`** exited 0.

## Needs Mac verification

These paths were read, not exercised against macOS, a live agent, or a logged-in provider.

- **Live Claude / Codex approval.** The web UI writes the choice through `pty_write` (`src/lib/approvals.ts:9-11`). Whether Claude's or Codex's TUI accepts that key, and whether a real full-screen prompt lands inside the last 24 rows (`agents.ts:93`), needs a Mac session. The Allow Bash miss above does not need a Mac; it fails on the string alone.
- **Claude hooks and Codex OSC notifications** (`src-tauri/src/agents.rs`, `Terminal.tsx:209-226`). A hook-reported `attention` still will not clear on answer while the screen state remains `attention` (P1.2).
- **Provider usage cards** from real logins (`UsagePanel.tsx` `provider_usage`). The layout bug is visible without them.
- **Tuck.** The button calls `toggleScreenshotMode` (`App.tsx:110-151`): leave fullscreen, shrink to 360×200, pin to the bottom-right of the current monitor, `setAlwaysOnTop(true)`. `screenshotMode` is set true before `setSize` / `setPosition`. If either throws, the next click takes the restore branch. Geometry and the global shortcut (`toggle-screenshot-mode`) need a Mac window.
- **Screenshot thumbnails** go through `sips` (`screenshots.rs:61`). This Linux run cannot. Clear-all behavior was tested with stubbed file metadata.
- **Desktop permission.** With no folder chosen, the gallery does not read Desktop (`screenshots.rs:36-42`). `open_privacy_settings` (`src-tauri/src/lib.rs:191-210`) tries the Files and Folders URL, then Full Disk Access, then Security. Those URLs were not opened.
- **Zen Studio.** The menu adds the panel. The panel polls `http://localhost:3003/` and opens `/Applications/Zen Studio.app` (`src/components/ZenPanel.tsx:13-50`). Embedding the real app was not run.

## Tooling

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass |
| Frontend lint | No `lint` script in `package.json` |
| Frontend tests | No `test` script |
| `cargo +stable check` (rustc 1.99.1) | Pass, `Finished dev profile` in 37s. The default rustc 1.83 cannot parse a transitive `edition2024` manifest, and the check needs the Linux WebKit/GTK dev packages (`gdk-3.0`, `javascriptcoregtk-4.1`). Those are environment requirements, not changes in this PR. |
| `cargo +stable test` | Pass. One unit test, `screenshots::tests::gallery_filters_sorts_and_limits_to_thirty`. |

Viewport for every shot: 1440×900.
