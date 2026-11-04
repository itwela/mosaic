# Mosaic redesign QA — round 4

**Score: 8/10.** Header-only Approve and Deny stay disabled, the 3-option Deny is `3\r`, the log-line false positive is gone, and the ring says THIS WORKSPACE. A real Codex menu whose question has scrolled off the last 24 lines is no longer a dialog, so this is not a 9.

Rechecked `fd79cb5`. Vite, Tauri stubbed, prompts through `pty-data`, 1440×900. `npm test` 7/7. `tsc --noEmit` passed. `cargo +stable check` passed. `cargo +stable test` passed.

## Verified

| Claim | Result |
| --- | --- |
| Header-only Allow | Card shows the full `Allow Bash(rm -rf public/old-icons)?`. Approve and Deny are `disabled`, titles "Waiting until the Yes/No row is visible". Clicking Deny wrote nothing. `qa/screenshots/app-bellhop.png`. |
| Rows then Deny | After `1. Yes` / `2. Yes, and don't ask again` / `3. No, and tell Claude…` both buttons enabled. Deny wrote `3\r`. Queue became Nothing waiting. `qa/screenshots/app-after-deny.png`. |
| `Allow WebFetch?` | Attention, Approve and Deny null until rows exist. With `1. Yes` / `2. No`, keys are `1\r` / `2\r`. |
| Wrapped Allow | Prompt is `Allow Bash(rm -rf public/old-icons)?`. No guessed number. |
| Codex upload | Full sentence, `y\r` / `n\r`. The visible bar's Approve was enabled and wrote `y\r`. |
| Codex numbered, question on screen | `Would you like to run / make the following edits / grant these permissions` → `1\r` / `2\r`. A `›` under the rows still detects. |
| Claude 2-option, reordered, 4-option | Deny is the first label that starts with No. `Yes, and don't ask again` is not that label. |
| `1. Yes we shipped the patch` / `2. No issues found in CI` | Not attention, including with `From the handbook:` above it. Written into Nym's terminal: the card stayed Nothing waiting. |
| Plain prose | `I already asked do you want to proceed? The user said yes yesterday.` is `unknown`. |
| Antigravity | Full sentence visible. Client height equals scroll height (59px). Line clamp is gone (`UsagePanel.css`). |
| Ring caption | Workspace ring is **THIS WORKSPACE**. Four tabs, 2 working / 1 need-you / 1 shell: center **04**, labels **02 / 01 / 00**. |
| Tests | Still 7. The 3-option Deny `3\r` assertion is test 2 (already there). Header-only null keys are tests 4 and 5. `Yes we shipped` / `No issues found` is test 7 (`tests/agents.test.ts:76-82`). That test replaced the old one that required scrolled-off option rows to be a dialog. |

Regressions that still pass: chips `#F3E2C4` / `#FFB547` / `#FF4A3D`, Idle, All Running toggle, five usage cards, `updated 0m ago`, heat table, ⌸ / ⌫, no folder glyph, hot links search / sort / launch, tab rename, drag onto Hala, Zen panel, absent field-notes files. ANSI around Allow Bash plus a 2-option menu is `1\r` / `2\r`. A buried Allow header under 30 lines stays `running`.

## Still broken

### P2 — Option rows alone are no longer a dialog

`detectScreenState` only returns attention from `permissionAtEnd` (`src/lib/agents.ts:224`). A permission header has to be inside the last 24 lines.

`1. Yes, proceed` / `2. No, and tell Codex what to do` with the question scrolled off is `unknown`. Round 3 treated that as a live Codex menu, and the previous test required it. Test 7 now asserts the opposite (`tests/agents.test.ts:81-82`).

`1. Yes we shipped` / `2. No issues found` should stay quiet, and it does. The real permission labels can be told apart from that log. Expected: rows whose labels are `Yes`, `Yes, proceed`, or `No, and tell Codex/Claude` still arm the bar when the question has left the window. A status log does not.

A handbook line that quotes the real menu (`do you want to proceed?` and then `1. Yes` / `2. No, and tell Claude…`) is still attention, because that string is the dialog. The shipped/issues handbook in the test is not.

## Needs a Mac

A live Claude or Codex TUI accepting the keystroke, including the moment before the option rows paint, real provider logins, Tuck's window geometry, `sips` thumbnails, the Desktop permission URLs, and Zen Studio listening on port 3003.

## Shots

- `qa/screenshots/app-bellhop.png` — header-only card, ring 04 THIS WORKSPACE, 02/01/00, full Antigravity line
- `qa/screenshots/app-after-deny.png` — Nothing waiting after Deny `3\r`
- `qa/screenshots/app-ring.png` — shipped/issues log did not open a card
- `qa/screenshots/app-all.png` — Idle, center caption LIVE
- `qa/screenshots/app-commands.png`
