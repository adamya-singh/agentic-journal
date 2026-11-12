import * as fs from 'fs';
import * as path from 'path';
import type { Task } from '@/lib/types';
import { journalDataDir } from '@/lib/backend-data';
import { buildTaskBrief, type BriefTaskRef, type JournalTaskEntry, type TaskBrief } from '@/lib/task-brief';
import { mergeAgentLayer } from '@/lib/brief-agent';
import { demoHook } from '@/lib/sunrise/demo-hooks';
import { readCompletedTaskIndex, readGeneralTasks } from '../today/today-store-utils';
import { readJobListings } from '../../jobs/job-store-utils';
import { readJobApplicationsStore } from '../../jobs/application-store-utils';
import { readAgentRecord, readAgentRecords } from '../brief-agent/store';

const JOURNAL_WINDOW_DAYS = 45;

function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => list.forEach((t) => { out.push(t); if (t.childTasks?.length) walk(t.childTasks); });
  walk(tasks);
  return out;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every planned or logged journal slot that points at a wanted task, a few weeks either side of today, by task.
// One pass over the day files however many tasks are wanted.
function journalEntriesByTask(wanted: (taskId: string) => boolean, now: Date): Map<string, JournalTaskEntry[]> {
  const out = new Map<string, JournalTaskEntry[]>();
  const dir = journalDataDir();
  if (!fs.existsSync(dir)) return out;
  const lo = ymd(new Date(now.getTime() - JOURNAL_WINDOW_DAYS * 864e5));
  const hi = ymd(new Date(now.getTime() + JOURNAL_WINDOW_DAYS * 864e5));
  for (const file of fs.readdirSync(dir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    if (!m || m[1] < lo || m[1] > hi) continue;
    let day: Record<string, unknown>;
    try { day = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
    const push = (hour: string, e: Record<string, unknown>) => {
      if (e && typeof e.taskId === 'string' && wanted(e.taskId)) {
        const list = out.get(e.taskId) ?? [];
        out.set(e.taskId, list);
        list.push({
          date: m[1], hour,
          entryMode: String(e.entryMode || 'logged'),
          planStatus: typeof e.planStatus === 'string' ? e.planStatus : undefined,
          autoPlanned: e.autoPlannedFromDueTime === true,
        });
      }
    };
    for (const [hour, e] of Object.entries(day)) {
      if (hour === 'ranges' && Array.isArray(e)) e.forEach((r) => push(`${r.start}–${r.end}`, r));
      else if (e && typeof e === 'object' && !Array.isArray(e)) push(hour, e as Record<string, unknown>);
    }
  }
  return out;
}

/** Every open (not completed, not daily) task on both lists, subtasks included. */
export function openTaskRefs(): BriefTaskRef[] {
  const pending = (t: Task) => !t.completed && !t.isDaily;
  return [
    ...flatten(readGeneralTasks('have-to-do').tasks).filter(pending).map((task) => ({ task, listType: 'have-to-do' as const })),
    ...flatten(readGeneralTasks('want-to-do').tasks).filter(pending).map((task) => ({ task, listType: 'want-to-do' as const })),
  ];
}

/**
 * The rule-built briefs for several tasks, before OpenClaw's layer, by task id. Tasks that aren't open are left
 * out. Everything the rules read (the journal's day files, the completed index, the job stores) is read once.
 */
export function loadRuleBriefs(taskIds: string[], now = new Date(), tasks = openTaskRefs()): Map<string, TaskBrief> {
  const wanted = new Set(taskIds);
  const out = new Map<string, TaskBrief>();
  if (wanted.size === 0) return out;
  const journal = journalEntriesByTask((id) => wanted.has(id), now);
  const completed = Object.values(readCompletedTaskIndex().tasks).map((t) => ({ id: t.id, text: t.text, completedAt: t.completedAt }));
  let listings: ReturnType<typeof readJobListings>['listings'] | null = null;
  let applications: ReturnType<typeof readJobApplicationsStore>['applications'] | null = null;

  for (const ref of tasks) {
    const taskId = ref.task.id;
    if (!wanted.has(taskId)) continue;
    // Online assessments link their application; the listing is keyed by the same id.
    let job = null;
    const appId = /\/jobs\?application=([0-9a-f-]{36})/.exec(ref.task.notesMarkdown || '')?.[1];
    if (appId) {
      listings ??= readJobListings().listings;
      applications ??= readJobApplicationsStore().applications;
      job = { listing: listings.find((l) => l.id === appId) ?? null, submittedAt: applications[appId]?.submittedAt ?? null };
    }
    const brief = buildTaskBrief({ taskId, tasks, completed, journal: journal.get(taskId) ?? [], job, now });
    if (brief) out.set(taskId, brief);
  }
  return out;
}

/**
 * The rule-built brief for one task, before OpenClaw's layer. Null when the task isn't open.
 */
export function loadRuleBrief(taskId: string, now = new Date(), tasks = openTaskRefs()): TaskBrief | null {
  return loadRuleBriefs([taskId], now, tasks).get(taskId) ?? null;
}

// SUNRISE_DEMO_HOOKS=1 (never in production) stands a hook in for every task OpenClaw has not started, made from
// the task's own brief, so Sunrise can be looked at where OpenClaw is not installed (lib/sunrise/demo-hooks.ts).
const demoHooks = () => process.env.SUNRISE_DEMO_HOOKS === '1' && process.env.NODE_ENV !== 'production';
const withDemoHook = (brief: TaskBrief): TaskBrief => (demoHooks() && !brief.hook ? { ...brief, hook: demoHook(brief) } : brief);

/** The brief as the Horizon shows it: the rules' brief with OpenClaw's layer merged in. */
export function loadTaskBrief(taskId: string, now = new Date()): TaskBrief | null {
  const tasks = openTaskRefs();
  const brief = loadRuleBrief(taskId, now, tasks);
  if (!brief) return null;
  return withDemoHook(mergeAgentLayer(brief, readAgentRecord(taskId), { tasks: new Map(tasks.map((r) => [r.task.id, r])), now }));
}

/** Several briefs as the Horizon shows them, by task id: one read of everything, however many tasks. */
export function loadTaskBriefs(taskIds: string[], now = new Date()): Map<string, TaskBrief> {
  const tasks = openTaskRefs();
  const records = readAgentRecords();
  const ctx = { tasks: new Map(tasks.map((r) => [r.task.id, r])), now };
  const out = new Map<string, TaskBrief>();
  for (const [taskId, brief] of loadRuleBriefs(taskIds, now, tasks)) out.set(taskId, withDemoHook(mergeAgentLayer(brief, records[taskId], ctx)));
  return out;
}
