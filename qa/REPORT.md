# Mosaic redesign QA — round 5

**Score: 9/10.** The scrolled-off Codex menu opens the card again and sends `1\r` / `2\r`, the shipped/CI list stays quiet, and the new tests assert those results. What is left is the card saying "Waiting for approval" when the question is gone, and a numbered line that only starts with a permission phrase.

Rechecked `8f16b26`. Vite, Tauri stubbed, prompts through `pty-data`, 1440×900. `npm test` 10/10. `tsc --noEmit` passed. `cargo +stable check` passed. `cargo +stable test` passed.

## Tests are real assertions

`tests/agents.test.ts` is 10 tests, not 7. None of the new ones are tautological.

| Test | What it checks |
| --- | --- |
| (a) lines 76–81 | `1. Yes we shipped the patch` / `2. No issues found in CI` is not attention, with and without `From the handbook:`. |
| (b) lines 83–89 | Header-only Allow Bash is attention and both keystrokes are `null`. |
| (c) lines 91–97 | `1. Yes, proceed` / `2. No, and tell Codex what to do` is attention, Approve `1\r`, Deny `2\r`. |
| (d) lines 99–104 | Same 3-option menu as test 2: Approve `1\r`, Deny `3\r`. Redundant with test 2, and it still checks the numbers. |

## Verified

- Scrolled-off Codex rows open the incoming card with Approve and Deny enabled. Approve wrote `1\r`. `qa/screenshots/app-scrolled.png`.
- Scrolled-off Claude `1. Yes` / `2. Yes, and don't ask again` / `3. No, and tell Claude what to do differently` is attention, Approve `1\r`, Deny `3\r`. A fourth `No, and stop` does not steal Deny. Reversed order sends Approve `2\r` and Deny `1\r`.
- `1. Yes we shipped the patch` / `2. No issues found in CI` stays quiet, including under `From the handbook:`. A live write of that list did not open a card.
- `Plan / 1. Install dependencies / 2. Run the tests / 3. Ship it` stays quiet.
- Plain "do you want to proceed?" prose stays `unknown`.
- Header-only Allow Bash and Allow WebFetch stay attention with null keys. With rows, Allow Bash Deny is `3\r` and WebFetch `1. Yes` / `2. No` is `1\r` / `2\r`.
- Wrapped Allow is the full question. Codex upload is the full sentence and `y\r` / `n\r`. Question-on-screen Codex menus (`run the following command`, `make the following edits`, `grant these permissions`) are `1\r` / `2\r`. ANSI around Allow Bash plus a 2-option menu is `1\r` / `2\r`.
- Ring on the four-tab mix is **04 THIS WORKSPACE** beside **02 / 01 / 00**. Antigravity's sentence is complete. Usage says `updated 0m ago`.
- Re-ran: hot-link search and launch, tab rename, Zen panel, command table, All Running Idle and the toggle back, absent field notes. Drag, glyphs, and chip colors were not re-clicked; `8f16b26` does not touch those files, and they passed on `fd79cb5`.

## Remaining

### P3 — The scrolled-off card says "Waiting for approval"

The menu is detected and the keys are right. `fullQuestion` finds nothing once the question has left the window, so the title falls back to the default (`src/lib/agents.ts:332`). The shot shows "Waiting for approval" with both buttons enabled.

Expected: the card shows the rows that are actually on screen, such as `1. Yes, proceed` / `2. No, and tell Codex what to do`.

### P3 — One permission-shaped line is enough

`permissionRowsAtEnd` (`src/lib/agents.ts:176-179`) is true when any numbered label matches `isPermissionChoice` and the screen ends on the last numbered line. It does not require a Yes row and a No row.

These opened a card:

- `1. Yes, proceed to chapter two of the book` / `2. Leave the ending` → attention, Approve `1\r`, Deny null.
- `1. No, and tell Claude the migration can wait until Friday` → attention, Deny `1\r`.

Expected: a permission menu, meaning a Yes-shaped row and a No-shaped row together. A sentence that only starts with "Yes, proceed" or "No, and tell Claude" stays quiet. `1. Yes` / `2. No` with nothing after them also stays quiet today (`isPermissionChoice` wants "No, and tell…" or "don't ask again"). The long Claude menu from the request does not have that gap.

## Needs a Mac

A live Claude or Codex TUI accepting the keystroke, including the frame before the option rows paint, real provider logins, Tuck's window geometry, `sips` thumbnails, the Desktop permission URLs, and Zen Studio listening on port 3003.

## Shots

- `qa/screenshots/app-scrolled.png` — scrolled Codex card, ring 04 THIS WORKSPACE, full Antigravity line
- `qa/screenshots/app-commands.png`
- `qa/screenshots/app-all.png`
