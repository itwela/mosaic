import { useSyncExternalStore } from "react";
import { v4 as uuidv4 } from "uuid";
import { insertAt, pushUndo } from "./undo";

// Command tasks: a named, ordered list of steps that make up one workflow
// (e.g. "Publish JobKompass CLI"). Each step is a note plus the command(s) to
// run. A task can be run top to bottom in a terminal or stepped through by hand.

export interface TaskStep {
  id: string;
  note?: string;
  command: string;
}

export interface CommandTask {
  id: string;
  name: string;
  steps: TaskStep[];
  runCount: number;
  lastRunAt?: number;
  createdAt: number;
}

const STORAGE_KEY = "mosaic-command-tasks";

let tasks: CommandTask[] = load();
const listeners = new Set<() => void>();

function load(): CommandTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* start fresh */
  }
  return seedTasks();
}

// First-launch tasks, so the workflows already in use show up without retyping.
function seedTasks(): CommandTask[] {
  const step = (note: string, command: string): TaskStep => ({ id: uuidv4(), note, command });
  return [
    {
      id: uuidv4(),
      name: "Publish JobKompass CLI",
      steps: [
        step("Log in to npm as cavemancreative. It'll ask for your password and one-time code.", "npm login"),
        step("Go to the CLI folder and pull the merged code.", "cd ~/Desktop/Code/jk-wt-actor/cli\ngit pull origin main"),
        step("Publish. It'll ask for a one-time code again.", "npm publish"),
        step("Check the new version, then update your own copy.", "npm view jobkompass-cli version\nnpm install -g jobkompass-cli@latest"),
      ],
      runCount: 0,
      createdAt: Date.now(),
    },
  ];
}

function mutate(fn: (t: CommandTask[]) => CommandTask[]) {
  tasks = fn(tasks);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    /* storage full or unavailable */
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTasks(): CommandTask[] {
  return useSyncExternalStore(subscribe, () => tasks);
}

export function newStep(command = "", note = ""): TaskStep {
  return { id: uuidv4(), command, note: note || undefined };
}

export function saveTask(task: { id?: string; name: string; steps: TaskStep[] }) {
  const steps = task.steps
    .map((s) => ({ ...s, command: s.command.trim(), note: s.note?.trim() || undefined }))
    .filter((s) => s.command);
  const name = task.name.trim() || "Untitled task";
  if (task.id && tasks.some((t) => t.id === task.id)) {
    mutate((d) => d.map((t) => (t.id === task.id ? { ...t, name, steps } : t)));
  } else {
    mutate((d) => [...d, { id: uuidv4(), name, steps, runCount: 0, createdAt: Date.now() }]);
  }
}

export function markRun(id: string) {
  mutate((d) => d.map((t) => (t.id === id ? { ...t, runCount: t.runCount + 1, lastRunAt: Date.now() } : t)));
}

export function removeTask(id: string) {
  const index = tasks.findIndex((t) => t.id === id);
  const task = tasks[index];
  mutate((d) => d.filter((t) => t.id !== id));
  if (task) {
    pushUndo(`Deleted task "${task.name}"`, () => {
      mutate((d) => (d.some((t) => t.id === task.id) ? d : insertAt(d, index, task)));
    });
  }
}

/** Joins every step into one shell line that stops at the first failure. */
export function taskScript(task: CommandTask): string {
  return task.steps
    .flatMap((s) => s.command.split("\n").map((l) => l.trim()).filter(Boolean))
    .join(" && ");
}

// Parses pasted runbook text (markdown with ``` fences, or plain lines) into
// steps. Text outside fences becomes the next step's note.
export function parseSteps(text: string): TaskStep[] {
  const steps: TaskStep[] = [];
  if (text.includes("```")) {
    const parts = text.split("```");
    let note = "";
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        note = part.trim().replace(/^\d+[.)]\s*/, "");
      } else {
        const command = part.replace(/^[a-z]*\n/i, "").trim();
        if (command) steps.push(newStep(command, note));
        note = "";
      }
    });
    return steps;
  }
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (l && !l.startsWith("#")) steps.push(newStep(l));
  }
  return steps;
}

// The terminal you last typed in; "Run" sends the task there.
let lastTerminalId: string | null = null;
export function setLastTerminal(id: string) {
  lastTerminalId = id;
}
export function getLastTerminal() {
  return lastTerminalId;
}
