// The task worker's batched sort (docs/task-worker-design.md, "Cost"). Before the sweep claims a task nobody handed
// over, OpenClaw reads its text, 30 tasks to a turn with no tools, and says whether there is anything to prepare:
// `nothing` (rest 30 days), `prepare` (the only verdict the sweep claims) or `ask` (one question; kept as a quiet
// list, never claimed). A task is sorted again when it changes or its verdict is 30 days old.
// Pure: no filesystem and no CLI, so the runner (src/app/api/tasks/work/sort.ts) and the tests share it.
import {
  localDay,
  quietHours,
  sortVerdict,
  sweepOrder,
  type TaskSortEntry,
  type TaskSortVerdict,
  type TaskWork,
  type TaskWorkRef,
} from '@/lib/task-work';

export const SORT_BATCH_SIZE = 30;
export const SORT_PACE_MS = 10 * 60_000;
export const SORT_DAILY_LIMIT = 12;
export const SORT_TURN_TIMEOUT_MS = 5 * 60_000;
export const SORT_FAILURE_LIMIT = 3;
export const SORT_FAILURE_REST_MS = 864e5;
export const SORT_NOTES_CHARS = 400;
const WHY_MAX = 200;
const Q_MAX = 300;
const VERDICTS: readonly TaskSortVerdict[] = ['nothing', 'prepare', 'ask'];

/** Open tasks the sort is about: not daily, no work record (a run or Adamya already decided those), parent not off. */
export function sortDomain<T extends TaskWorkRef>(records: Record<string, TaskWork>, refs: T[]): T[] {
  return refs.filter((r) => !r.isDaily && !records[r.taskId] && !(r.parentTaskId && records[r.parentTaskId]?.status === 'off'));
}

/** The tasks that need a verdict now, in the sweep's order (so what the sweep would claim first is sorted first). */
export function sortCandidates<T extends TaskWorkRef>(
  records: Record<string, TaskWork>, refs: T[], sort: Record<string, TaskSortEntry>, now: Date
): T[] {
  return sweepOrder(sortDomain(records, refs).filter((r) => sortVerdict(sort[r.taskId], r.fingerprint, now) === null), now);
}

/** How the sort stands, for the overview: tasks in the domain with a current verdict, and of which kind. */
export function sortCounts(records: Record<string, TaskWork>, refs: TaskWorkRef[], sort: Record<string, TaskSortEntry>, now: Date) {
  const counts = { sorted: 0, unsorted: 0, prepare: 0, nothing: 0, ask: 0 };
  for (const ref of sortDomain(records, refs)) {
    const v = sortVerdict(sort[ref.taskId], ref.fingerprint, now);
    if (v) { counts.sorted += 1; counts[v] += 1; } else counts.unsorted += 1;
  }
  return counts;
}

// ───────────── the batch and its prompt ─────────────

export interface SortTaskInput {
  taskId: string;
  text: string;
  dueDate?: string;
  projects?: string[];
  notesMarkdown?: string;
  fingerprint: string;
}

export interface SortBatch {
  /** alias (t1…t30) → task id. The reply is read through this map only: ids it returns are never trusted. */
  aliases: Record<string, string>;
  tasks: (SortTaskInput & { alias: string })[];
}

export function buildSortBatch(tasks: SortTaskInput[]): SortBatch {
  const picked = tasks.slice(0, SORT_BATCH_SIZE).map((t, i) => ({ ...t, alias: `t${i + 1}` }));
  return { aliases: Object.fromEntries(picked.map((t) => [t.alias, t.taskId])), tasks: picked };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function notesHead(notes: string | undefined): string {
  const flat = oneLine(notes ?? '');
  return flat.length > SORT_NOTES_CHARS ? `${flat.slice(0, SORT_NOTES_CHARS)}…` : flat;
}

export function buildSortPrompt(batch: SortBatch, opts: { now: Date; forAgents?: string }): string {
  const lines = batch.tasks.map((t) => JSON.stringify({
    id: t.alias,
    task: t.text,
    ...(t.dueDate ? { due: t.dueDate } : {}),
    ...(t.projects?.length ? { project: t.projects.join(', ') } : {}),
    ...(t.notesMarkdown?.trim() ? { notes: notesHead(t.notesMarkdown) } : {}),
  }));
  const guidance = opts.forAgents?.trim();
  return `Agentic Journal is sorting Adamya's open tasks, so that its task worker only spends a run on tasks where there is something to prepare.

Judge from the text below only. Use no tools: no browsing, no searching, no reading email, Canvas, files or sessions, no commands. Change nothing anywhere and message no one. Your reply is the only thing you produce.

For each task give one verdict:
- "nothing": only Adamya can do it (attend a class, exercise, read, study, be somewhere), or there is no first step an assistant could usefully prepare.
- "prepare": there is a concrete first step OpenClaw could prepare that only Adamya would see: find the form and list its fields, draft the email, gather the requirements, compare options, find the deadline.
- "ask": one answer from Adamya would unlock it. Put that one question in "q".

Coursework: prepare only, never the work itself. Job applications and online assessments belong to other workers: nothing.
${guidance ? `
Adamya's guidance for agents in this period of his life (judgment guidance; while it is in force it overrides generic bars about what is worth doing):
${guidance}
` : ''}
Now: ${localDay(opts.now)}
Tasks, one JSON object per line (id, task, due date, project, the start of the notes):
${lines.join('\n')}

Reply with ONLY one JSON object, no prose, no code fence, with one key for every id above:
{"t1":{"v":"nothing","why":"<one line>"},"t2":{"v":"prepare","why":"<the first step, one line>"},"t3":{"v":"ask","why":"<one line>","q":"<the one question>"}}`;
}

// ───────────── the reply ─────────────

export interface SortReplyItem { v: TaskSortVerdict; why: string; q?: string }

export interface SortReplyCheck {
  /** By task id (mapped back through the aliases). */
  verdicts: Record<string, SortReplyItem>;
  /** Task ids sent and not given a usable verdict. */
  missing: string[];
  problems: string[];
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Reads OpenClaw's reply item by item: unknown aliases are dropped, an item with a wrong verdict (or an `ask`
 * without its question) counts as missing, and an unreadable reply leaves every task missing.
 */
export function validateSortReply(raw: unknown, aliases: Record<string, string>): SortReplyCheck {
  const verdicts: Record<string, SortReplyItem> = {};
  const problems: string[] = [];
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!obj) problems.push('reply was not a JSON object');
  for (const [key, value] of Object.entries(obj ?? {})) {
    const alias = key.trim().toLowerCase();
    const taskId = Object.prototype.hasOwnProperty.call(aliases, alias) ? aliases[alias] : undefined;
    if (!taskId) { problems.push(`unknown id ${clip(key, 20)}`); continue; }
    const item = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const v = typeof item?.v === 'string' ? item.v.trim().toLowerCase() : '';
    if (!VERDICTS.includes(v as TaskSortVerdict)) { problems.push(`${alias}: verdict ${clip(String(item?.v ?? 'missing'), 20)}`); continue; }
    const why = typeof item!.why === 'string' ? clip(oneLine(item!.why), WHY_MAX) : '';
    const q = typeof item!.q === 'string' ? clip(oneLine(item!.q), Q_MAX) : '';
    if (v === 'ask' && !q) { problems.push(`${alias}: ask without a question`); continue; }
    verdicts[taskId] = { v: v as TaskSortVerdict, why, ...(v === 'ask' ? { q } : {}) };
  }
  const missing = Object.values(aliases).filter((id) => !verdicts[id]);
  return { verdicts, missing, problems };
}

/**
 * Writes a batch's outcome into the store's sort data. Only tasks that are still in the sort's domain with the
 * fingerprint that was sent are touched: a task handed over or edited meanwhile is left for the next batch. A task
 * left without a verdict three batches in a row rests as `nothing` for a day.
 */
export function applySortOutcome(
  data: { sort: Record<string, TaskSortEntry>; sortFailures: Record<string, number> },
  sent: { taskId: string; fingerprint: string }[],
  check: Pick<SortReplyCheck, 'verdicts'>,
  current: (taskId: string) => string | null,   // the task's fingerprint now, or null when it left the domain
  now: Date
): { sorted: number; failed: number; rested: number } {
  const at = now.toISOString();
  let sorted = 0, failed = 0, rested = 0;
  for (const { taskId, fingerprint } of sent) {
    if (current(taskId) !== fingerprint) continue;
    const verdict = check.verdicts[taskId];
    if (verdict) {
      data.sort[taskId] = { ...verdict, fingerprint, at };
      delete data.sortFailures[taskId];
      sorted += 1;
      continue;
    }
    const failures = (data.sortFailures[taskId] ?? 0) + 1;
    failed += 1;
    if (failures >= SORT_FAILURE_LIMIT) {
      data.sort[taskId] = {
        v: 'nothing', why: `OpenClaw could not sort it ${failures} times`, fingerprint, at,
        again: new Date(now.getTime() + SORT_FAILURE_REST_MS).toISOString(),
      };
      delete data.sortFailures[taskId];
      rested += 1;
    } else {
      data.sortFailures[taskId] = failures;
    }
  }
  return { sorted, failed, rested };
}

// ───────────── pacing ─────────────

export interface SortPacingInput {
  now: Date;
  disabled: boolean;               // TASK_SORT_DISABLED, TASK_WORKER_DISABLED or TASK_WORKER_SWEEP_DISABLED
  sweepEnabled: boolean;
  running: boolean;                // a sort turn is in flight
  runs: { date: string; count: number; lastAt?: string } | undefined;
  candidates: number;
}

export type SortDecision = 'run' | 'disabled' | 'sweep-off' | 'quiet' | 'running' | 'paced' | 'daily-limit' | 'nothing';

/** Whether to send a sort batch now: one at a time, at most one per 10 minutes and 12 a day, never at night. */
export function decideSortBatch(input: SortPacingInput): SortDecision {
  if (input.disabled) return 'disabled';
  if (!input.sweepEnabled) return 'sweep-off';
  if (quietHours(input.now)) return 'quiet';
  if (input.running) return 'running';
  const t = input.now.getTime();
  if (input.runs?.lastAt && t - Date.parse(input.runs.lastAt) < SORT_PACE_MS) return 'paced';
  if (input.runs?.date === localDay(input.now) && input.runs.count >= SORT_DAILY_LIMIT) return 'daily-limit';
  if (input.candidates === 0) return 'nothing';
  return 'run';
}

/** The pacing record after starting a batch now. */
export function countSortRun(runs: SortPacingInput['runs'], now: Date): NonNullable<SortPacingInput['runs']> {
  const today = localDay(now);
  return { date: today, count: (runs?.date === today ? runs.count : 0) + 1, lastAt: now.toISOString() };
}
