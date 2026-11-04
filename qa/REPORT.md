# Mosaic redesign QA — round 2

**Score: 7/10.** The round-1 approval alarm and the chrome checklist are fixed and rechecked; Deny on Claude's three-option menu still types "Yes, and don't ask again", and the ring is 03 beside the guide's 02/01/00 rather than 04.

Rebased `qa/mosaic-redesign-review` onto `afacbf6` (`cursor/mosaic-redesign-6c1c`). The builder's checklist was not taken as evidence. Same method as round 1: Vite at 1440×900, Tauri stubbed, prompt text written through the `pty-data-*` listener. The guide was remeasured from the mockup after boot: Working **02**, Need you **01**, Ready **00**, ring **04**.

## Verified fixed

| Item | What I saw |
| --- | --- |
| P1 Allow Bash card | Incoming card: **Hala Card · Claude Code · 0m ago · Allow Bash(rm -rf public/old-icons)?** with Approve, Deny, Open. The bytes were ANSI-colored (`ESC[31m…ESC[0m`) and xterm still produced the question. `qa/screenshots/app-bellhop.png`. |
| P1 Approve clears that card | Approve wrote `1\r`. The Hala card left. A second, different prompt (Nym, "Do you want to proceed?") stayed, which is the queue, not the same alarm. `qa/screenshots/app-after-approve.png`. |
| P1 Deny clears | Deny on that Nym card wrote `2\r` (its menu is `1. Yes` / `2. No`) and the card became **Nothing waiting**. `qa/screenshots/app-after-deny.png`. |
| Codex upload sentence | `Upload to Vercel blob and replace / the links in /resources?` is attention. The Codex pane showed the red Approve / Deny / Reply bar. Approve wrote `y\r` (no numbered Yes on that sentence) and the bar left. |
| Scrollback | After the answer, burying Allow Bash under 40 lines of ordinary output did not reopen the card. Painting the same question at the bottom again did reopen it. That matches `App.tsx:233-236`: once the prompt leaves the live window the dismissal is dropped, so a new paint can light it; text that has scrolled out of the last screenful does not. |
| Chips | Active workspace chips computed to `rgb(243, 226, 196)`, `rgb(255, 181, 71)`, `rgb(255, 74, 61)`. |
| Idle + toggle | All Running's third label is **Idle**. A second click returned the title to Bellhop / Kodawari. `qa/screenshots/app-all.png`. |
| Usage row | Five cards (Claude, Codex, Cursor, Antigravity, DeepSeek) share one y position. Hot Links is 378px wide and AI usage is 768px, the extra columns. `qa/screenshots/app-bellhop.png`. |
| Commands | One `.commands-table` with heat pips, command, label, category, count, Copy. Search "postgres" left `npm run db:local`. `qa/screenshots/app-commands.png`. |
| Age | Incoming meta is `0m ago`. |
| Glyphs | Visible terminal headers' toolbox and clear buttons read ⌸ and ⌫. |
| Folder glyph | No `.screenshot-folder` in the strip. Empty-folder copy still offers choosing a folder. |
| CRT grade | `.g-grain`, `.g-rgb`, and `.g-scan` at opacity 0.55 are in the tree. Title and label `text-shadow` is the red/blue split (`workshop.css:98-100`). Terminal canvases and fields are excluded (`workshop.css:101-107`). |
| Regressions | Sidebar chips showed 2 shells / 2 working / 1 attention and tracked the answers. Hot links search, A–Z order, and Launch (4 `open_path` calls) worked. Drag moved a panel from Bellhop (6→5) onto Hala (1→2). Tab double-click opened the rename field. Window → Zen Studio added the panel. Field notes with the gitignored files absent says there is no client data and does not show 92/133. `git diff 2d2cbbd..afacbf6` does not touch `my-clients.js`, `workstreams-data.js`, or `files/`. |

`npx tsc --noEmit` passed. `cargo +stable check` passed. `cargo +stable test` passed (`gallery_filters_sorts_and_limits_to_thirty`).

## Ring: the guide is 02/01/00 and 04, and those are not the same sum

Remeasured from the mockup (`qa/screenshots/ref-workspace.png`): center **04**, labels **02 / 01 / 00**. 2+1+0 is 3, so the guide's four figures are not a sum. The sidebar on that board shows 4 terminal sessions.

On a matching mix (2 working, 1 need-you, 0 ready, 2 shell panes) the app reads center **03**, labels **02 Working / 01 Need you / 00 Ready** (`WorkspaceDashboard.tsx:51-53`, `qa/screenshots/app-bellhop.png`). The three labels match the guide. The center is their sum, so it cannot also be the guide's 04 while Ready stays 00. Shells are no longer added in; that part of the old bug is fixed.

The checklist's **04 beside 02/01/01** is what this formula produces when one agent is Ready. It is internally consistent. It is not the board printed in the guide, which has Ready at 00.

All Running is consistent with the same rule: center 07 beside 03 Working / 02 Need you / 02 Idle, and 3+2+2=7 (`AllRunningView.tsx:57-69`). Idle there is shells plus ready.

## New defects

### P1 — Deny on Claude's three-option menu types "Yes, and don't ask again"

`Do you want to proceed?` with

```
1. Yes
2. Yes, and don't ask again
3. No, and tell Claude what to do differently
```

is detected, and Approve is `1\r`. Deny is `2\r`.

`extractApproval` treats a line as No when it contains `no`, `deny`, `don't`, or `block` (`src/lib/agents.ts:284`). Option 2 matches `don't`, and it is found before option 3. Deny would type the yes that also stops future prompts.

Expected: Deny sends `3\r`, the line that is actually No. A two-option menu (`1. Yes` / `2. No, and tell Claude`) does send `2\r`, and that path was checked live.

### P2 — Any "do you want to …?" sentence lights the alarm

`I already asked do you want to proceed? The user said yes yesterday.` is `attention`, with Approve `1\r` and Deny `2\r`.

The choice half of the Claude rule includes a bare `\?` (`src/lib/agents.ts:138`), and a second rule matches the question with no option rows (`src/lib/agents.ts:171`). The comment above the rule table (`agents.ts:110-112`) says anchoring on the question alone matches an agent describing an approval. That is what this sentence is.

Expected: a mention of the question in ordinary output stays off the red card. The live dialog, with its option rows or an `Allow Tool(...)?` line, is the card.

### P2 — A split Allow line is shown as ")?"

`Allow Bash(\nrm -rf public/old-icons\n)?` is detected, and the key is the full question, but `extractApproval` uses the last line that ends in `?` (`src/lib/agents.ts:279-285`). That line is `)?`, so the incoming card would title itself `)?`.

The wrapped upload sentence has the same picker: the card prompt is `the links in /resources?` rather than the whole sentence. The one-line form `Upload to Vercel blob and replace the links?` is kept whole.

Expected: the card shows the question the guide prints, including when the closing `?` sits on its own line.

### P2 — Center is 03 where the guide prints 04

Covered above. Labels 02/01/00 match. Center does not. `WorkspaceDashboard.tsx:53`.

## P3

- `Allow WebFetch?` with no parentheses is `unknown` (`src/lib/agents.ts:170` requires `(...)`). `Allow Edit(src/App.tsx)?` and `Allow Bash(...)?` are detected.
- The usage header still says "updated just now" (`UsagePanel.tsx` `ago`, around the 138–143 definitions). The incoming card is `0m ago`. The guide's usage line is a minute stamp ("updated 2m ago").
- The five usage cards fit one row and the Antigravity sentence wraps hard inside its fifth. Readable, tight.
- Gemini `Allow execution of` is detected. The extracted prompt is the option row `1. Allow once`, same last-match behavior as the split Allow line.

## Variants that did detect

Checked through the app's own `detectScreenState` / `extractApproval`, plus the live ANSI Allow Bash write:

- `Allow Bash(rm -rf public/old-icons)?` alone, and with `1. Yes` / `2. No` (approve `1\r`, deny `2\r`).
- `Allow Edit(src/App.tsx)?`.
- `Do you want to make this edit?` with Yes / No.
- `Would you like to run the following command?`, `make the following edits?` (`Yes, just this once`), and `grant these permissions?`.
- Codex option rows with the question scrolled off (`1. Yes, proceed` / `2. No, and tell Codex`).
- Claude option rows with the question scrolled off.
- The same Allow Bash line buried under 30 lines and followed by `esc to interrupt` stays `running`.
- ANSI color bytes around Allow Bash still detect once xterm has interpreted them (the live card) and even on the raw string.

## Needs a Mac

Unchanged, and not claimed as done here: a live Claude or Codex TUI accepting the keystroke, real provider logins, Tuck's window geometry and always-on-top, `sips` thumbnails, the Desktop / Full Disk Access URLs, and Zen Studio actually serving on port 3003. The Zen menu still adds the panel.

## Shots

All 1440×900.

- `qa/screenshots/ref-workspace.png` — guide, ring 04, labels 02/01/00
- `qa/screenshots/ref-all.png`
- `qa/screenshots/app-bellhop.png` — Allow Bash card, ring 03, five usage cards
- `qa/screenshots/app-after-approve.png` — Hala cleared, Nym still queued
- `qa/screenshots/app-after-deny.png` — Nothing waiting
- `qa/screenshots/app-all.png` — Idle
- `qa/screenshots/app-commands.png` — heat table, postgres search
- `qa/screenshots/app-ring.png` — after the Codex answer, 03 Working / 00 Need you / 00 Ready
- `qa/screenshots/app-drag.png`
