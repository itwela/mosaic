import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  CommandTask,
  markRun,
  newStep,
  parseSteps,
  removeTask,
  saveTask,
  taskScript,
  TaskStep,
  useTasks,
} from "../store/tasks";
import Icon from "./Icon";

interface Draft {
  id?: string;
  name: string;
  steps: TaskStep[];
}

// Command tasks: groups of commands that make up one workflow, run in order.
export default function CommandTasks() {
  const tasks = useTasks();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Set<string>>>({});
  const [flash, setFlash] = useState<{ id: string; msg: string } | null>(null);

  function notify(id: string, msg: string) {
    setFlash({ id, msg });
    setTimeout(() => setFlash((f) => (f?.id === id && f.msg === msg ? null : f)), 2200);
  }

  async function copy(text: string, id: string, msg = "Copied") {
    try {
      await writeText(text);
      notify(id, msg);
    } catch (err) {
      console.error(err);
    }
  }

  function run(task: CommandTask) {
    const data = taskScript(task);
    window.dispatchEvent(new CustomEvent("mosaic-run-task", {
      detail: {
        data,
        done: (ok: boolean) => {
          if (ok) { markRun(task.id); return; }
          copy(data, task.id, "No terminal yet — copied instead. Click into a terminal, then Run.");
        },
      },
    }));
  }

  function toggleStep(taskId: string, stepId: string) {
    setDone((d) => {
      const set = new Set(d[taskId] ?? []);
      if (set.has(stepId)) set.delete(stepId); else set.add(stepId);
      return { ...d, [taskId]: set };
    });
  }

  function updateStep(i: number, patch: Partial<TaskStep>) {
    setDraft((d) => d && { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }

  function moveStep(i: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });
  }

  function importPaste() {
    const steps = parseSteps(paste);
    if (!steps.length) return;
    setDraft((d) => d && { ...d, steps: [...d.steps.filter((s) => s.command.trim()), ...steps] });
    setPaste("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || !draft.steps.some((s) => s.command.trim())) return;
    saveTask(draft);
    setDraft(null);
  }

  return (
    <section className="tasks-section">
      <div className="tasks-head">
        <div>
          <div className="commands-eyebrow">Tasks</div>
          <p className="tasks-sub">Groups of commands you run together, in order.</p>
        </div>
        {!draft && (
          <button className="commands-add-btn" onClick={() => setDraft({ name: "", steps: [newStep()] })}>
            <Icon name="plus" size={12} /> New task
          </button>
        )}
      </div>

      {draft && (
        <form className="task-editor" onSubmit={submit}>
          <input
            className="task-name-input"
            placeholder="Task name, e.g. Publish JobKompass CLI"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
          <div className="task-paste">
            <textarea
              placeholder="Paste a runbook (markdown with ``` code blocks, or one command per line) to fill the steps…"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={3}
            />
            <button type="button" className="commands-copy-btn" disabled={!paste.trim()} onClick={importPaste}>
              Import steps
            </button>
          </div>
          <ol className="task-edit-steps">
            {draft.steps.map((s, i) => (
              <li key={s.id} className="task-edit-step">
                <span className="task-step-num">{i + 1}</span>
                <div className="task-edit-fields">
                  <input
                    placeholder="Note (optional), e.g. It'll ask for a one-time code"
                    value={s.note ?? ""}
                    onChange={(e) => updateStep(i, { note: e.target.value })}
                  />
                  <textarea
                    className="task-edit-command"
                    placeholder="Command(s), one per line"
                    value={s.command}
                    rows={Math.max(1, s.command.split("\n").length)}
                    onChange={(e) => updateStep(i, { command: e.target.value })}
                  />
                </div>
                <div className="task-edit-step-actions">
                  <button type="button" title="Move up" onClick={() => moveStep(i, -1)}>↑</button>
                  <button type="button" title="Move down" onClick={() => moveStep(i, 1)}>↓</button>
                  <button
                    type="button"
                    title="Remove step"
                    onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}
                  >×</button>
                </div>
              </li>
            ))}
          </ol>
          <div className="task-editor-actions">
            <button type="button" className="commands-copy-btn" onClick={() => setDraft({ ...draft, steps: [...draft.steps, newStep()] })}>
              <Icon name="plus" size={12} /> Add step
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" className="commands-copy-btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" className="commands-add-btn" disabled={!draft.steps.some((s) => s.command.trim())}>
              Save task
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 && !draft && (
        <div className="tasks-empty">No tasks yet. Make one for any workflow you repeat.</div>
      )}

      <div className="tasks-list">
        {tasks.map((task) => {
          const isOpen = open === task.id;
          const doneSet = done[task.id] ?? new Set<string>();
          return (
            <div key={task.id} className={`task-card${isOpen ? " task-open" : ""}`}>
              <div className="task-card-top">
                <button className="task-toggle" onClick={() => setOpen(isOpen ? null : task.id)}>
                  <span className="task-caret">{isOpen ? "▾" : "▸"}</span>
                  <span className="task-name">{task.name}</span>
                  <span className="commands-cat-count">
                    {task.steps.length} step{task.steps.length === 1 ? "" : "s"}
                    {task.runCount > 0 ? ` · ${task.runCount}× run` : ""}
                  </span>
                </button>
                <div className="task-card-actions">
                  <button className="commands-add-btn" onClick={() => run(task)} title="Run every step in the terminal you last typed in, stopping at the first failure">
                    ▶ Run
                  </button>
                  <button className="commands-copy-btn" onClick={() => copy(taskScript(task), task.id)} title="Copy all steps as one line">
                    <Icon name="copy" size={12} /> Copy all
                  </button>
                  <button className="commands-copy-btn" onClick={() => setDraft({ id: task.id, name: task.name, steps: task.steps.map((s) => ({ ...s })) })}>
                    Edit
                  </button>
                  <button className="commands-delete-btn" onClick={() => removeTask(task.id)} title="Delete task">×</button>
                </div>
              </div>
              {flash?.id === task.id && <div className="task-flash">{flash.msg}</div>}
              {isOpen && (
                <ol className="task-steps">
                  {task.steps.map((s, i) => (
                    <li key={s.id} className={`task-step${doneSet.has(s.id) ? " task-step-done" : ""}`}>
                      <button className="task-step-check" onClick={() => toggleStep(task.id, s.id)} title="Mark done">
                        {doneSet.has(s.id) ? "✓" : i + 1}
                      </button>
                      <div className="task-step-body">
                        {s.note && <div className="task-step-note">{s.note}</div>}
                        <code className="commands-item-text" onClick={() => copy(s.command, task.id, `Copied step ${i + 1}`)} title="Click to copy">
                          {s.command}
                        </code>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
