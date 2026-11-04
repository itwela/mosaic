# Mosaic redesign QA — round 3

**Score: 8/10.** The claimed keystrokes, the full wrapped question, and a ring of 04 beside 02/01/00 all check out. A screen that merely ends in numbered Yes/No lines still opens the red card, so this is not a 9.

Rechecked `180d0ac` on `cursor/mosaic-redesign-6c1c` after rebasing `qa/mosaic-redesign-review`. Vite, Tauri stubbed, prompts written through `pty-data`, 1440×900. `npm test` is 7/7. `npx tsc --noEmit` passed. `cargo +stable check` passed. `cargo +stable test` passed (`gallery_filters_sorts_and_limits_to_thirty`).

## Verified

| Claim | Result |
| --- | --- |
| Claude 2-option | `1. Yes` / `2. No, and tell Claude what to do differently` → Approve `1\r`, Deny `2\r`. |
| Claude 3-option | `1. Yes` / `2. Yes, and don't ask again` / `3. No, and tell Claude what to do differently` → Approve `1\r`, Deny `3\r`. Live Deny on Nym wrote `3\r` and the queue became Nothing waiting. `qa/screenshots/app-after-deny.png`. |
| Options in another order | `1. No…` / `2. Yes, and don't ask again` / `3. Yes` → Approve `3\r`, Deny `1\r`. |
| Four options | Deny is the first label that starts with No (`3\r`), not the later `4. No, and stop`. |
| `Yes, don't ask again` without "and" | Still not treated as the plain Yes. Deny stays `3\r`. |
| Wrapped Allow Bash | Card text is the full `Allow Bash(rm -rf public/old-icons)?`, not `)?`. Approve on that header-only prompt wrote `1\r`. `qa/screenshots/app-bellhop.png`. |
| Codex upload sentence | Detected. Prompt is the whole sentence. Approve `y\r`, Deny `n\r`. The visible bar's Approve wrote `y\r`. |
| Codex numbered rows | `1. Yes, proceed` / `2. No, and tell Codex…` → `1\r` / `2\r`, including when the question has scrolled off. A `›` composer under the rows still detects. |
| Prose "do you want to proceed?" | Alone, and with another sentence after it, state is `unknown`. |
| Buried answered prompt | After Allow Bash was answered, 36 ordinary lines did not reopen the card. Painting the question at the bottom again did. |
| Two agents at once | Incoming read "1 of 2". Approving Hala left Nym's "Do you want to proceed?". `qa/screenshots/app-after-approve.png`. |
| Ring | Four terminal tabs, statuses 2 working / 1 need-you / 1 shell: center **04**, labels **02 Working / 01 Need you / 00 Ready**. That is the accepted call, and the two sides are consistent with each other. The count is tabs, not panes: `terminalPanes` adds `panel.tabs.length` (`src/lib/approvals.ts:54-58`). Two tabs in one pane count as two. |
| Usage age | Header reads `updated 0m ago`. |
| Regressions | Chips `#F3E2C4` / `#FFB547` / `#FF4A3D`. Idle label, All Running toggles back. Five usage cards on one row. Commands heat table, postgres search. ⌸ and ⌫. No folder glyph. Hot links search, A–Z, Launch (4 `open_path`s). Tab rename. Drag onto Hala. Zen Studio panel ("Zen Studio isn't running"). Field notes files absent, no fake 92/133, and this commit does not touch them. |

## Allow Bash / Allow WebFetch with no numbers

The code does what was claimed: no numbered rows, and the line matches `allow <name>`, so Approve is `1\r` and Deny is `2\r` (`src/lib/agents.ts:308-311`).

That Approve key matches Claude Code's first option. The Deny key does not match Claude's usual menu. The dialog that actually ships is three options: 1 Yes, 2 Yes and don't ask again, 3 No. A header-only frame has not shown those rows yet, and Deny `2` is the don't-ask-again Yes, which is the round-2 bug in the case where the rows are missing. Deny `2` is right only for a two-option menu. Once the rows are on screen, the No line is chosen (verified `3\r`).

## Still broken

### P2 — A trailing Yes/No list is a dialog, even in prose or a log

`choicesAtEnd` (`src/lib/agents.ts:154-169`) treats the screen as attention when the bottom lines are numbered, one label starts with "yes" (and is not "don't ask again"), and another starts with "no".

Both of these light the card and offer `1\r` / `2\r`:

- `The handbook shows an example of do you want to proceed?` followed by `1. Yes` / `2. No, and tell Claude what to do differently`.
- `1. Yes we shipped the patch` / `2. No issues found in CI`, with no permission question at all. The card title is then "Waiting for approval".

The second one was also written into Nym's live terminal and opened the incoming card (`qa/screenshots/app-ring.png`).

Expected: a permission dialog, or option rows whose labels are the real choices (`Yes`, `No, and tell Claude…`). A status log or a handbook example stays quiet.

### P2 — Header-only Deny is hard-coded to 2

`src/lib/agents.ts:311`. Expected: Deny waits until a line that starts with No is on screen, then sends that number. On Claude's three-option menu that number is 3, not 2.

### P3 — Antigravity line is still clipped

Not claimed fixed. The card's note is line-clamped (`src/components/UsagePanel.css:112-120`). Measured client height 45px against a scroll height of 59px, so "Open Antigravity to see its quota (it reports usage only while running)." is cut to "…usage only." Expected: the full sentence, as on the guide's usage card.

### P3 — The ring caption says PANES

The guide's caption is THIS WORKSPACE. The workspace ring and All Running both say PANES (`src/components/WorkspaceDashboard.tsx:73`, `src/components/AllRunningView.tsx:65`). The number under it is the tab count described above.

## Needs a Mac

A live Claude or Codex TUI accepting the keystroke (including a header-only frame before the option rows paint), real provider logins, Tuck's window geometry and always-on-top, `sips` thumbnails, the Desktop permission URLs, and Zen Studio actually listening on port 3003. The panel itself renders and offers Open.

## Shots

- `qa/screenshots/app-bellhop.png` — Allow Bash card, ring 04, labels 02/01/00, usage `updated 0m ago`
- `qa/screenshots/app-after-approve.png` — Hala cleared, Nym still queued
- `qa/screenshots/app-after-deny.png` — Nothing waiting
- `qa/screenshots/app-ring.png` — prose-plus-options false positive, Zen Studio panel
- `qa/screenshots/app-all.png` — Idle
- `qa/screenshots/app-commands.png` — heat table
- `qa/screenshots/ref-workspace.png` — guide, for the 04 / 02/01/00 comparison
