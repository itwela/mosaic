import { AgentStatus } from "../types";

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

export function screenWindow(screen: string, lines = SCREEN_WINDOW): string {
  const rows = screen.split("\n");
  return rows
    .slice(Math.max(0, rows.length - lines))
    .join(" ")
    .replace(/\u00a0/g, " ")
    .replace(BOX_GLYPHS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A prompt is only a prompt if the answer rows are on screen too. Anchoring on
// the question alone matches an agent *describing* an approval, and matching any
// single option matches a collapsed tool summary in the transcript.
interface AttentionRule {
  anchor: RegExp;
  choice: RegExp;
}

const ATTENTION_RULES: AttentionRule[] = [
  // Codex 0.164. The options differ per prompt type (command, edits, network,
  // permissions, send-input), so the first version's "yes, proceed" requirement
  // silently missed every variant that offered "yes, just this once".
  {
    anchor: /would you like to (?:run the following command|make the following edits|grant these permissions|send input to)/,
    choice: /(?:^|\s)(?:\d\.\s*yes|yes, (?:proceed|just this once)|no, (?:and tell codex|continue without running it|and block))/,
  },
  // Gemini CLI tool confirmation. "Allow execution of" also survives in the
  // collapsed history row after answering, so the live dialog is identified by
  // its numbered rows: the summary keeps the words but not the "1. Allow once".
  {
    anchor: /allow execution of/,
    choice: /(?:^|\s)\d\.\s*(?:allow (?:once|for this session|tool for this session|all server tools)|no, (?:suggest changes|deny))/,
  },
  // Claude Code permission prompt. Numbered rows are the strict form; the
  // question alone is also matched below, because the options wrap off the
  // collapsed line or are not drawn yet.
  {
    anchor: /do you want to\b/,
    choice: /(?:^|\s)\d\s*[.)]\s*yes|yes, and don'?t ask again|no, and tell claude|\?/,
  },
  {
    anchor: /would you like to proceed|review the plan and approve/,
    choice: /(?:^|\s)\d\s*[.)]\s*(?:yes|no)/,
  },
];

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
  const text = screenWindow(screen);
  for (const rule of ATTENTION_RULES) {
    if (rule.anchor.test(text) && rule.choice.test(text)) return "attention";
  }
  // Claude's permission dialog. "Allow Bash(rm -rf public/old-icons)?" is the
  // whole prompt; the 1. Yes / 2. No rows are sometimes on the next paint.
  // Only the live window is searched, so a mention higher in scrollback does
  // not count.
  if (/allow\s+[a-z0-9][\w.-]*\s*\([^)]*\)\s*\?/.test(text)) return "attention";
  if (/do you want to\b[^?]{0,160}\?/.test(text)) return "attention";
  // The sentence the workshop guide prints in the Codex pane. The real Codex
  // TUI line ("would you like to run the following command?" plus its numbered
  // rows) is the rule above; this does not replace it.
  if (/upload to vercel blob and replace[^?]{0,160}\?/.test(text)) return "attention";
  // A short pane scrolls the question off and leaves the live option rows.
  // Those rows are the dialog, not a transcript line: both the yes and the no
  // are on screen together.
  if (/(?:^|\s)\d\s*[.)]\s*yes, (?:proceed|just this once)/.test(text) && /no, and tell codex/.test(text)) return "attention";
  if (/(?:^|\s)\d\s*[.)]\s*yes\b/.test(text) && /no, and tell claude/.test(text)) return "attention";
  // Direct question that names the requirement, with no option list to anchor on.
  if (/(?:waiting for (?:your|user) (?:input|approval)|permission required)/.test(text)) return "attention";
  // Work indicators before the input footer: TUIs keep their composer visible
  // while a turn is still running.
  if (RUNNING_RULES.some((rule) => rule.test(text))) return "running";
  if (READY_RULES.some((rule) => rule.test(text))) return "ready";
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
  approve: string;
  deny: string;
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
  approve: "y\r",
  deny: "n\r",
  key: "waiting",
};

// What makes this dialog the same dialog after a repaint. Prefer the option
// rows, which stay put when the question wraps off a short pane.
export function attentionKey(screen: string): string {
  const text = screenWindow(screen);
  const yes = text.match(/(?:^|\s)(\d\s*[.)]\s*yes\b[^|]{0,48})/);
  const no = text.match(/(?:^|\s)(\d\s*[.)]\s*no\b[^|]{0,48})/);
  if (yes && no) return `${yes[1].trim()}|${no[1].trim()}`;
  const allow = text.match(/allow\s+[a-z0-9][\w.-]*\s*\([^)]*\)\s*\?/);
  if (allow) return allow[0];
  const ask = text.match(/(?:do you want to|would you like to|upload to vercel blob and replace)[^?]{0,120}\?/);
  if (ask) return ask[0].replace(/\s+/g, " ").trim();
  return text.slice(-60);
}

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

// Pull the question and the yes/no keystrokes out of the live screen. Numbered
// rows ("1. Yes", "2. No") win; otherwise the answer is y / n.
export function extractApproval(screen: string): ApprovalOffer {
  const rows = screen.split("\n").map((line) =>
    line.replace(/\u00a0/g, " ").replace(BOX_GLYPHS, " ").replace(/\s+/g, " ").trim(),
  ).filter(Boolean);
  const tail = rows.slice(-SCREEN_WINDOW);
  const text = tail.join("\n").toLowerCase();
  const question = [...tail].reverse().find((line) =>
    /\?\s*$/.test(line) || /allow |do you want|would you like|permission required|waiting for/.test(line.toLowerCase()),
  );
  const numbered = [...text.matchAll(/(?:^|\s)(\d)\s*[.)]\s*([^\n]{0,80})/g)];
  const yes = numbered.find((match) => /\byes\b|\ballow\b|\bproceed\b|\bapprove\b/.test(match[2]));
  const no = numbered.find((match) => /\bno\b|\bdeny\b|\bdon'?t\b|\bblock\b/.test(match[2]));
  const prompt = (question || DEFAULT_APPROVAL.prompt).slice(0, 220);
  // Claude's selector takes 1 and 2 even when the option rows have not been
  // captured. Codex's numbered rows still win when they are on screen.
  const claudeMenu = /allow\s+[a-z0-9][\w.-]*\s*\(/.test(text) || /do you want to\b/.test(text);
  return {
    prompt,
    approve: yes ? `${yes[1]}\r` : claudeMenu ? "1\r" : DEFAULT_APPROVAL.approve,
    deny: no ? `${no[1]}\r` : claudeMenu ? "2\r" : DEFAULT_APPROVAL.deny,
    key: attentionKey(screen),
  };
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
