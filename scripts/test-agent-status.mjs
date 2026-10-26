import ts from 'typescript';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/agents.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { detectScreenState, classifyStatus } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

// Screens below are copied from the installed CLIs (Codex 0.164.0, Gemini 0.25.2)
// or from the wrapped/bordered way those screens land in a narrow Mosaic panel.
const cases = [
  [
    'Codex idle screen (captured live)',
    `› Ask Codex to do anything

  GPT-6.1-Sol low fast · ~/Desktop/Code/mosaic
  ← for agents · ? for shortcuts                                        ⚠ 1 warning · f2 to view`,
    'ready',
  ],
  [
    'Codex command approval',
    `  Would you like to run the following command?

  $ npm run build

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command in this session (a)
  3. No, and tell Codex what to do differently (esc)`,
    'attention',
  ],
  [
    // The regression that made the feature look dead: this prompt offers
    // "Yes, just this once" and never the word "proceed".
    'Codex approval without the word proceed',
    `  Would you like to run the following command?

  $ git push origin main

› 1. Yes, just this once (y)
  2. No, and tell Codex what to do differently (esc)`,
    'attention',
  ],
  [
    'Codex network approval',
    `  Would you like to grant these permissions?

  Network access to api.openai.com

› 1. Yes, just this once
  2. Yes, and allow this host for this conversation
  3. No, and block this host in the future`,
    'attention',
  ],
  [
    'Codex approval wrapped in a bordered box (narrow panel)',
    `╭──────────────────────────────────────────────╮
│ Would you like to run the following          │
│ command?                                     │
│                                              │
│ $ npm test                                   │
│                                              │
│ ❯ 1. Yes, just this once                     │
│   2. No, and tell Codex what to do           │
│      differently (esc)                       │
╰──────────────────────────────────────────────╯`,
    'attention',
  ],
  [
    'Codex finished turn',
    `Worked for 23s
› Ask Codex to do anything
GPT-6.1-Sol low fast`,
    'ready',
  ],
  [
    'Codex working',
    `Working… (esc to dismiss)
› Ask Codex to do anything`,
    'running',
  ],
  [
    'Gemini idle screen (captured live)',
    `  Type your message or @path/to/file

  auto · Gemini 3.8 Flash · high`,
    'ready',
  ],
  [
    // Answered confirmation collapses into a tool summary that keeps the
    // header text. It scrolled above the composer, so it must not go red.
    'Gemini idle with an answered confirmation in history',
    [
      "╭──────────────────────────────────────────────╮",
      "│ ✓ Shell  npm test                            │",
      "│   Allow execution of: 'npm' 'test'           │",
      "│   Allow once · Allow for this session        │",
      "╰──────────────────────────────────────────────╯",
      "",
      "  All 12 tests passed.",
      "",
      "  Type your message or @path/to/file",
      "",
      "  auto · Gemini 3.8 Flash · high",
      ...Array.from({ length: 14 }, (_, i) => `  line ${i + 1}`),
      "  Type your message or @path/to/file",
    ].join("\n"),
    'ready',
  ],
  [
    'Gemini tool confirmation (live)',
    `╭──────────────────────────────────────────────╮
│ Allow execution of: 'npm' 'test'?            │
│                                              │
│ ● 1. Allow once                              │
│   2. Allow for this session                  │
│   3. No, suggest changes (esc)               │
╰──────────────────────────────────────────────╯`,
    'attention',
  ],
  [
    'Gemini working',
    `Thinking… (esc to cancel, 5s)
? for shortcuts`,
    'running',
  ],
  [
    'Claude Code permission prompt',
    `Do you want to proceed?
❯ 1. Yes
  2. Yes, and don't ask again for npm commands
  3. No, and tell Claude what to do differently (esc)`,
    'attention',
  ],
  [
    'Narrative mention is not an approval',
    'The documentation describes a permission prompt and asks whether you would like to run a command.',
    'unknown',
  ],
  [
    'Quiet request has no proven state',
    'Contacting model server',
    'unknown',
  ],
];

for (const [name, screen, expected] of cases) {
  assert.equal(detectScreenState(screen), expected, name);
}

const session = { id: 'test', chain: ['/bin/zsh', '/opt/bin/codex'], running: true, silent_ms: 0, has_process: true };
assert.equal(classifyStatus(session, 'attention'), 'attention', 'CPU activity must not override approval');
assert.equal(classifyStatus({ ...session, running: false, silent_ms: 600000 }, 'unknown'), 'ready', 'silence must not create attention (a quiet agent is at its prompt)');
assert.equal(classifyStatus({ ...session, silent_ms: 500 }, 'unknown'), 'running', 'a redrawing agent is working');

// Self-reported state (Claude Code hooks / OSC 9 notifications) beats the screen.
const t = 1_000_000;
assert.equal(classifyStatus({ ...session, hook_state: 'attention', hook_at: t }, 'unknown'), 'attention', 'permission hook raises attention');
assert.equal(classifyStatus({ ...session, hook_state: 'attention', hook_at: t }, 'unknown', { inputAt: t + 1 }), 'running', 'answering the prompt clears attention');
assert.equal(classifyStatus({ ...session, hook_state: 'ready', hook_at: t, silent_ms: 0 }, 'unknown'), 'ready', 'stop hook means ready even while the screen redraws');
assert.equal(classifyStatus(session, 'unknown', { notify: { state: 'attention', at: t } }), 'attention', 'OSC 9 approval notification raises attention');
assert.equal(classifyStatus({ ...session, hook_state: 'ended', hook_at: t, silent_ms: 600000 }, 'unknown'), 'ready', 'ended sessions fall back to the screen');
assert.equal(classifyStatus(session, 'ready'), 'ready');
assert.equal(classifyStatus({ ...session, chain: ['/bin/zsh', 'node vite'] }, 'attention'), 'terminal', 'non-agent output does not trigger agent approval');
assert.equal(classifyStatus({ ...session, chain: ['/bin/zsh', 'node /usr/local/bin/gemini'] }, 'attention'), 'attention', 'gemini binary resolves from a node command line');

console.log(`${cases.length + 11} agent status regression checks passed`);
