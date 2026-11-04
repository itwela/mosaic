import type { AgentStatus } from "../types";

// Shape returned by the Rust `pty_statuses` command for each live terminal.
export interface SessionStatus {
  id: string;
  foreground: string;
  chain: string[];
  running: boolean;
  silent_ms: number;
  has_process: boolean;
  // State the agent reported itself via the Mosaic hooks (Claude Code), with
  // the time it was written in ms since the epoch.
  hook_state?: string | null;
  hook_at?: number | null;
}

// Signals the frontend collects per tab: desktop notifications the agent sent
// through the terminal (OSC 9 / OSC 777, used by Codex and others) and the last
// time the user typed into the tab.
export interface TabSignals {
  notify?: { state: "attention" | "ready"; at: number };
  inputAt?: number;
  // The question currently in the live viewport, and the same question after
  // the user has already answered it. A matching dismissal keeps a prompt that
  // is still sitting in the last screenful from painting the tab red again.
  screenPrompt?: string;
  dismissedPrompt?: string;
}

// A TUI that is working redraws its spinner every frame. Several seconds of
// total silence means it is sitting at its prompt.
const QUIET_MS = 4000;

interface AgentBadge {
  key: string;
  name: string;
  glyph: string;
  logo?: string;
  color: string;
}

// Known agent binaries, in priority order. `key` is matched (lowercased)
// against the process names in a terminal's process tree.
const AGENTS: AgentBadge[] = [
  { key: "claude", logo: "/agent-logos/claude.svg", name: "Claude Code", glyph: "✳", color: "#D97757" },
  { key: "opencode", logo: "/agent-logos/opencode.svg", name: "OpenCode", glyph: "◈", color: "#A78BFA" },
  { key: "codex", logo: "/agent-logos/openai.svg", name: "Codex", glyph: "⌘", color: "#10A37F" },
  { key: "antigravity", logo: "/agent-logos/antigravity.svg", name: "Antigravity", glyph: "▲", color: "#4285F4" },
  { key: "cursor-agent", logo: "/agent-logos/cursor.svg", name: "Cursor", glyph: "▮", color: "#E8E8E8" },
  { key: "cursor", logo: "/agent-logos/cursor.svg", name: "Cursor", glyph: "▮", color: "#E8E8E8" },
  { key: "gemini", logo: "/agent-logos/gemini.svg", name: "Gemini", glyph: "✦", color: "#9A8CFF" },
  { key: "aider", name: "Aider", glyph: "A", color: "#5B8DEF" },
  { key: "warp", name: "Warp", glyph: "▢", color: "#01A4FF" },
  { key: "cline", logo: "/agent-logos/cline.svg", name: "Cline", glyph: "C", color: "#B05CFF" },
  { key: "roo", name: "Roo", glyph: "R", color: "#D97757" },
  { key: "copilot", logo: "/agent-logos/copilot.svg", name: "Copilot", glyph: "⎇", color: "#8B949E" },
  { key: "openclaw", logo: "/agent-logos/openclaw.svg", name: "OpenClaw", glyph: "◈", color: "#7AAB9C" },
  { key: "kairo", name: "Kairo", glyph: "◈", color: "#7AAB9C" },
  { key: "gpt", logo: "/agent-logos/openai.svg", name: "GPT", glyph: "✦", color: "#10A37F" },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectAgent(chain: string[]): string | null {
  // `chain` now holds full command lines (argv), not truncated `comm`. Match the
  // agent binary name as a whole word anywhere in the command so pathed names
  // ("…/bin/codex") and truncated ones still resolve.
  const haystack = chain.map((c) => c.toLowerCase());
  if (haystack.some((c) => /\b(?:antigravity|agy|language_server_macos(?:_arm|_x64)?)\b/.test(c))) return "antigravity";
  for (const agent of AGENTS) {
    const re = new RegExp(`\\b${escapeRegExp(agent.key)}\\b`);
    if (haystack.some((h) => re.test(h))) return agent.key;
  }
  return null;
}

export function agentBadge(key: string | null): AgentBadge | null {
  if (!key) return null;
  return AGENTS.find((a) => a.key === key) ?? null;
}

// Inspect the rendered terminal screen, rather than raw ANSI chunks or CPU
// scheduling state. Quiet network requests and animated prompts are both common.
export type AgentScreenState = "attention" | "running" | "ready" | "unknown";

// Only the bottom of the viewport counts. A tool confirmation that was answered
// ten minutes ago still sits in scrollback, and matching it keeps a finished tab
// red forever. Live dialogs are always drawn at the bottom, above the composer.
const SCREEN_WINDOW = 24;

// Borders, bullets, selection carets and spinner frames sit *inside* the words
// when a panel is narrow: "│ 1. Yes, just│" / "  this once (y)". Strip them, then
// collapse the wrap so a phrase reads the same at any panel width.
const BOX_GLYPHS = /[\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2022\u2026\u00b7\u203a\u2039\u276f\u276e]/g;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function screenLines(screen: string, lines = SCREEN_WINDOW): string[] {
  return stripAnsi(screen)
    .split("\n")
    .map((line) => line.replace(/\u00a0/g, " ").replace(BOX_GLYPHS, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-lines);
}

// One line, original case, with a wrap's break inside parentheses closed up
// so "Allow Bash(\n rm …\n)?" reads as the question the guide prints.
function flatScreen(lines: string[]): string {
  return lines.join(" ")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}

export function screenWindow(screen: string, lines = SCREEN_WINDOW): string {
  return flatScreen(screenLines(screen, lines)).toLowerCase();
}

// A live dialog sits at the bottom of the viewport. Option rows are the bottom,
// or a known permission header is the bottom. A question mentioned in prose,
// with more output after it, is not a dialog.
const PERMISSION_HEAD = [
  /allow\s+[a-z0-9][\w.-]*\s*(?:\([^)]*\))?\s*\?/gi,
  /allow execution of\b[^?]*\?/gi,
  /upload to vercel blob and replace\b[^?]*\?/gi,
  /would you like to (?:run the following command|make the following edits|grant these permissions|send input to|proceed)\b[^?]*\?/gi,
  /do you want to\b[^?]*\?/gi,
  /review the plan and approve\b[^?]*\?/gi,
];

interface Choice {
  n: string;
  label: string;
}

function parseChoices(flat: string): Choice[] {
  const marks = [...flat.matchAll(/(?:^|\s)(\d+)\s*[.)]\s+/g)];
  const choices: Choice[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? flat.length) : flat.length;
    const label = flat.slice(start, end).replace(/\s+/g, " ").trim();
    if (label) choices.push({ n: marks[i][1], label });
  }
  return choices;
}

// The label itself must begin with Yes. "Yes, and don't ask again" is a
// different choice — the word "don't" is not a No.
function isPlainYes(label: string): boolean {
  const text = label.toLowerCase();
  if (!text.startsWith("yes")) return false;
  return !/^yes,?\s+and\s+don'?t\s+ask\s+again\b/.test(text);
}

function isNo(label: string): boolean {
  return label.toLowerCase().startsWith("no");
}

// Permission wording, not any line that happens to start with Yes or No.
// "Yes, proceed" and "No, and tell Codex…" are a dialog. "Yes we shipped the patch" is not.
function isPermissionChoice(label: string): boolean {
  const text = label.toLowerCase();
  return /^yes,\s+(?:proceed|just this once)\b/.test(text)
    || /^yes,?\s+and\s+don'?t\s+ask\s+again\b/.test(text)
    || /^no,\s+and\s+tell\s+(?:claude|codex)\b/.test(text)
    || /^no,\s+(?:suggest changes|deny|and block|continue without)\b/.test(text)
    || /^allow\s+(?:once|for this session|tool for this session|all server tools)\b/.test(text);
}

function permissionRowsAtEnd(flat: string): boolean {
  const choices = parseChoices(flat);
  if (!choices.some((choice) => isPermissionChoice(choice.label))) return false;
  return flat.trimEnd().endsWith(choices[choices.length - 1].label);
}

// The text after a permission header is its option rows, and nothing else.
function optionsOnly(after: string): boolean {
  const choices = parseChoices(after);
  if (!choices.some((choice) => isPlainYes(choice.label) || choice.label.startsWith("allow"))) return false;
  if (!choices.some((choice) => isNo(choice.label))) return false;
  return after.trimEnd().endsWith(choices[choices.length - 1].label);
}

function permissionAtEnd(flat: string): boolean {
  let end = -1;
  for (const pattern of PERMISSION_HEAD) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(flat))) {
      const at = match.index + match[0].length;
      if (at > end) end = at;
    }
  }
  if (end < 0) return false;
  const after = flat.slice(end).trim();
  if (!after) return true;
  return optionsOnly(after);
}

function fullQuestion(flat: string): string | null {
  let best: { at: number; text: string } | null = null;
  for (const pattern of PERMISSION_HEAD) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(flat))) {
      if (!best || match.index >= best.at) best = { at: match.index, text: match[0].trim() };
    }
  }
  const ask = /do you want to\b[^?]*\?/gi;
  let match: RegExpExecArray | null;
  while ((match = ask.exec(flat))) {
    if (!best || match.index >= best.at) best = { at: match.index, text: match[0].trim() };
  }
  return best?.text ?? null;
}

const RUNNING_RULES: RegExp[] = [
  /\besc to (?:interrupt|cancel|dismiss|stop)\b/,
  /\b(?:ctrl|control)\+c to (?:interrupt|cancel|stop)\b/,
  /\b(?:thinking|working|generating|executing|researching|responding)\s*(?:\.\.\.|…|\()/,
];

const READY_RULES: RegExp[] = [
  /ask (?:codex|claude|gemini|opencode) to/,
  /type your message/,
  /@path\/to\/file/,
  /for shortcuts/,
  /what would you like to do/,
  /[›❯]\s*(?:ask|try|type|$)/,
];

export function detectScreenState(screen: string): AgentScreenState {
  const lines = screenLines(screen);
  const flat = flatScreen(lines).toLowerCase();
  // A permission header at the bottom, or option rows whose labels are the
  // dialog itself ("Yes, proceed", "No, and tell Codex…") after the question
  // has scrolled off. "1. Yes we shipped the patch" is not that dialog.
  if (permissionAtEnd(flat) || permissionRowsAtEnd(flat)) return "attention";
  if (/(?:waiting for (?:your|user) (?:input|approval)|permission required)\s*$/.test(flat)) return "attention";
  if (RUNNING_RULES.some((rule) => rule.test(flat))) return "running";
  if (READY_RULES.some((rule) => rule.test(flat))) return "ready";
  return "unknown";
}

export function classifyStatus(s: SessionStatus, screen: AgentScreenState = "unknown", signals: TabSignals = {}): AgentStatus {
  const agent = detectAgent(s.chain);
  if (!agent) return s.has_process ? "terminal" : "idle";

  // The newest event the agent itself reported wins over reading the screen.
  const hook = s.hook_state && s.hook_at && s.hook_state !== "ended"
    ? { state: s.hook_state, at: s.hook_at }
    : null;
  const notify = signals.notify ?? null;
  const reported = hook && notify ? (hook.at >= notify.at ? hook : notify) : hook ?? notify;
  const answered = reported && (signals.inputAt ?? 0) > reported.at;
  // The viewport can keep showing the question after the keystroke. That copy
  // is the one the user just answered, not a new ask, so it must not hold the
  // alarm. A different question is a new prompt and is not dismissed.
  const dismissed = !!signals.screenPrompt
    && signals.dismissedPrompt === signals.screenPrompt;

  if (screen === "attention" && !dismissed) return "attention";
  if (reported?.state === "attention" && !answered && !dismissed) return "attention";
  if (screen === "running") return "running";
  if (reported?.state === "running") return s.silent_ms > QUIET_MS * 15 ? "ready" : "running";
  if (reported?.state === "ready" && !answered) return "ready";
  if (screen === "ready") return "ready";
  // Silence alone used to count as "running", which painted every idle agent
  // orange. A working TUI is never quiet for long.
  return s.silent_ms > QUIET_MS ? "ready" : "running";
}

// What to type into a terminal that is waiting on the user. `approve` / `deny`
// are the keystrokes for the option currently on screen (a numbered choice, or
// y/n when the prompt has no numbers). They are written to that tab's PTY.
export interface ApprovalOffer {
  prompt: string;
  // Null until that row is actually on screen. A header-only Allow prompt
  // must not guess 1 or 2 — option 2 on Claude's menu is "don't ask again".
  approve: string | null;
  deny: string | null;
  // Stable identity of this dialog. Wrapping the question onto fewer rows does
  // not change it; a different yes/no pair, or a different question, does.
  key: string;
}

export interface TabMeta {
  status: AgentStatus;
  agent: string | null;
  approval?: ApprovalOffer;
}

const DEFAULT_APPROVAL: ApprovalOffer = {
  prompt: "Waiting for approval",
  approve: null,
  deny: null,
  key: "waiting",
};

export function sessionToMeta(
  s: SessionStatus,
  screen: AgentScreenState = "unknown",
  signals: TabSignals = {},
  approval: ApprovalOffer | null = null,
): TabMeta {
  const status = classifyStatus(s, screen, signals);
  return {
    status,
    agent: detectAgent(s.chain),
    approval: status === "attention" ? (approval ?? DEFAULT_APPROVAL) : undefined,
  };
}

// The keystroke is the number on the option whose label begins with Yes or No.
// "Yes, and don't ask again" is not the one-time Yes, and the "don't" inside it
// is not a No. A Codex sentence with no numbered rows is y / n.
export function extractApproval(screen: string): ApprovalOffer {
  const flat = flatScreen(screenLines(screen));
  const lower = flat.toLowerCase();
  const choices = parseChoices(lower);
  const yes = choices.find((choice) => isPlainYes(choice.label));
  const no = choices.find((choice) => isNo(choice.label));
  // Codex sentences with no numbered rows (the upload line) are y / n.
  // An Allow / "do you want" header waits until its Yes and No rows are visible.
  const codexYn = !yes && !no && /upload to vercel blob and replace\b|would you like to\b/.test(lower);
  const prompt = (fullQuestion(flat) || DEFAULT_APPROVAL.prompt).slice(0, 220);
  const approve = yes ? `${yes.n}\r` : codexYn ? "y\r" : null;
  const deny = no ? `${no.n}\r` : codexYn ? "n\r" : null;
  return { prompt, approve, deny, key: `${prompt}|${approve ?? ""}|${deny ?? ""}` };
}

// Classify the text of a desktop notification an agent sent via OSC 9/777.
export function notificationState(text: string): "attention" | "ready" {
  return /approv|permission|confirm|allow|waiting for (?:your )?input|needs? your|requires? (?:your )?(?:input|attention)/i.test(text)
    ? "attention"
    : "ready";
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  // Workshop palette: cream shells, amber working, ruby needs-you.
  // Ready stays the ring's cobalt so it matches the third figure.
  idle: "#3B3227",
  ready: "#7C9BFF",
  terminal: "#F3E2C4",
  running: "#FFB547",
  attention: "#FF4A3D",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "idle",
  ready: "agent ready for a new prompt",
  terminal: "terminal process running",
  running: "agent running",
  attention: "needs attention",
};
